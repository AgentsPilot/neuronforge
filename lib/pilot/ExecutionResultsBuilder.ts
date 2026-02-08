/**
 * ExecutionResultsBuilder - Generates structured execution summaries
 *
 * Purpose:
 * - Automatically extract counts and metrics from ANY step output
 * - No hardcoded plugin logic - works generically with any data structure
 * - Power the Insight System to detect hardcoded values vs dynamic data
 *
 * CRITICAL SECURITY REQUIREMENT:
 * - NO client data stored (no content, names, values, etc.)
 * - ONLY store counts, types, and structure metadata
 * - Safe for database storage and analysis
 *
 * @module lib/pilot/ExecutionResultsBuilder
 */

import type { ExecutionContext } from './ExecutionContext';

export interface ExecutionResultItem {
  stepId: string;
  stepName: string;
  plugin: string;
  action: string;
  itemCount: number;        // Count of items processed (0 for non-array outputs)
  dataType: string;         // 'array', 'object', 'primitive', 'null'
  sampleKeys?: string[];    // For objects: top-level keys (max 5, no values)
  status: 'success' | 'warning' | 'error';
  friendlyMessage?: string; // Human-readable summary (e.g., "Found 10 emails", "No new rows added")
}

export interface StructuredExecutionResults {
  summary: string;
  items: ExecutionResultItem[];
  totalItems: number;
  totalSteps: number;
  metadata: {
    executionTime: number;
    stepsCompleted: number;
    tokensUsed: number;
  };
}

export class ExecutionResultsBuilder {
  /**
   * Build structured execution results from final output and execution trace
   * Works generically with ANY data structure - no hardcoded plugin logic
   */
  static build(context: ExecutionContext, finalOutput: any): StructuredExecutionResults {
    const items: ExecutionResultItem[] = [];

    // Get execution trace which has step metadata
    const executionTrace = context.getExecutionTrace();

    // Process each step from execution trace
    for (const stepExec of executionTrace.stepExecutions) {
      const stepId = stepExec.stepId;
      const stepOutput = finalOutput[stepId];

      if (!stepOutput) continue;

      const item = this.analyzeStepOutput(
        stepId,
        stepExec.plugin,
        stepExec.action,
        stepExec.metadata?.stepName || stepId,
        stepOutput,
        stepExec.metadata?.success !== false
      );

      items.push(item);
    }

    // Calculate totalItems as the FINAL OUTCOME, not sum of all steps
    // Use the last non-system step's count (avoids double-counting intermediate processing)
    const meaningfulSteps = items.filter(item => item.plugin !== 'system');
    const finalStep = meaningfulSteps[meaningfulSteps.length - 1];
    const totalItems = finalStep?.itemCount || 0;

    const summary = this.generateSummary(items, totalItems);

    return {
      summary,
      items,
      totalItems,  // ← Now represents FINAL OUTCOME, not sum
      totalSteps: items.length,
      metadata: {
        executionTime: context.totalExecutionTime,
        stepsCompleted: context.completedSteps.length,
        tokensUsed: context.totalTokensUsed,
      },
    };
  }

  /**
   * Analyze a single step output to extract counts and structure
   * NO client data - only counts and types
   */
  private static analyzeStepOutput(
    stepId: string,
    plugin: string,
    action: string,
    stepName: string,
    stepOutput: any,
    success: boolean
  ): ExecutionResultItem {
    // Determine data type and count from sanitized output
    let dataType: string;
    let itemCount: number = 0;
    let sampleKeys: string[] | undefined;

    // Check if this is already sanitized output (has 'type' and 'count' fields)
    if (stepOutput && typeof stepOutput === 'object') {
      // Look for arrays with count metadata
      const arrayFields = Object.values(stepOutput).filter(
        (v: any) => v && v.type === 'array' && typeof v.count === 'number'
      ) as any[];

      if (arrayFields.length > 0) {
        // Sum up all array counts
        itemCount = arrayFields.reduce((sum: number, field: any) => sum + field.count, 0);
        dataType = 'array';

        // Get sample keys from first array field
        const firstArray = arrayFields[0];
        if (firstArray.sample_keys && Array.isArray(firstArray.sample_keys)) {
          sampleKeys = firstArray.sample_keys.slice(0, 5);
        }
      } else if (stepOutput.count !== undefined) {
        // Direct count field (e.g., from transforms)
        itemCount = stepOutput.count || 0;
        dataType = 'object';
      } else if (stepOutput.type) {
        // Has type metadata
        dataType = stepOutput.type;
        itemCount = stepOutput.count || 1;
        sampleKeys = stepOutput.sample_keys?.slice(0, 5);
      } else {
        // Generic object
        dataType = 'object';
        itemCount = 1;
        sampleKeys = Object.keys(stepOutput).slice(0, 5);
      }
    } else if (stepOutput === null || stepOutput === undefined) {
      dataType = 'null';
      itemCount = 0;
    } else {
      dataType = 'primitive';
      itemCount = 1;
    }

    // Generate friendly message based on action verb and count
    const friendlyMessage = this.generateFriendlyMessage(action, stepName, itemCount, stepOutput, sampleKeys);

    return {
      stepId,
      stepName,
      plugin,
      action,
      itemCount,
      dataType,
      sampleKeys,
      status: success ? 'success' : 'error',
      friendlyMessage,
    };
  }

  /**
   * Generate human-friendly message from action verb and count
   * Uses generic patterns - NO hardcoded plugin logic
   */
  private static generateFriendlyMessage(
    action: string,
    stepName: string,
    itemCount: number,
    stepOutput: any,
    sampleKeys?: string[]
  ): string {
    // Determine the action verb (search, read, write, send, etc.)
    const actionLower = action.toLowerCase();

    // Check for special count fields that indicate write operations
    if (stepOutput && typeof stepOutput === 'object') {
      if (stepOutput.appended_rows !== undefined) {
        const count = stepOutput.appended_rows || 0;
        return count === 0
          ? 'No new rows added (all items already exist or were filtered out)'
          : `Added ${count} new row${count !== 1 ? 's' : ''}`;
      }
      if (stepOutput.updated_rows !== undefined) {
        const count = stepOutput.updated_rows || 0;
        return count === 0
          ? 'No rows updated'
          : `Updated ${count} row${count !== 1 ? 's' : ''}`;
      }
      if (stepOutput.deleted_count !== undefined || stepOutput.deleted_rows !== undefined) {
        const count = stepOutput.deleted_count || stepOutput.deleted_rows || 0;
        return count === 0
          ? 'No items deleted'
          : `Deleted ${count} item${count !== 1 ? 's' : ''}`;
      }
    }

    // Extract data noun from action name or sampleKeys
    // e.g., "search_emails" -> "emails", "list_files" -> "files"
    const extractNoun = (): string => {
      // Try to extract from action name
      const parts = actionLower.split('_');
      if (parts.length > 1) {
        const noun = parts[parts.length - 1];
        // Common plural nouns
        if (noun === 'emails' || noun === 'files' || noun === 'rows' || noun === 'items' ||
            noun === 'messages' || noun === 'folders' || noun === 'documents') {
          return noun;
        }
        // Singular that should be pluralized
        if (noun === 'email') return 'emails';
        if (noun === 'file') return 'files';
        if (noun === 'row') return 'rows';
        if (noun === 'message') return 'messages';
        if (noun === 'folder') return 'folders';
        if (noun === 'sheet') return 'sheets';
        // Special case: "range" -> "rows" (for spreadsheet operations)
        if (noun === 'range') return 'rows';
        return noun + 's';
      }

      // Try to extract from sample keys (the field name that contains the data)
      if (sampleKeys && sampleKeys.length > 0) {
        const meaningfulKey = sampleKeys.find(k =>
          k !== 'type' && k !== 'count' && k !== 'sample_keys' &&
          k !== 'success' && k !== 'message' && k !== 'result'
        );
        if (meaningfulKey) {
          return meaningfulKey.replace(/_/g, ' ');
        }
      }

      return 'items';
    };

    const noun = extractNoun();

    // Generate message based on action verb
    if (actionLower.includes('search') || actionLower.includes('find') || actionLower.includes('list')) {
      return itemCount === 0
        ? `No ${noun} found`
        : `Found ${itemCount} ${noun}`;
    }

    if (actionLower.includes('read') || actionLower.includes('get') || actionLower.includes('fetch')) {
      return itemCount === 0
        ? `No ${noun} retrieved`
        : `Retrieved ${itemCount} ${noun}`;
    }

    if (actionLower.includes('write') || actionLower.includes('append') || actionLower.includes('add')) {
      return itemCount === 0
        ? `No ${noun} added`
        : `Added ${itemCount} ${noun}`;
    }

    if (actionLower.includes('update') || actionLower.includes('modify')) {
      return itemCount === 0
        ? `No ${noun} updated`
        : `Updated ${itemCount} ${noun}`;
    }

    if (actionLower.includes('delete') || actionLower.includes('remove')) {
      return itemCount === 0
        ? `No ${noun} deleted`
        : `Deleted ${itemCount} ${noun}`;
    }

    if (actionLower.includes('send')) {
      return itemCount === 0
        ? `Nothing sent`
        : itemCount === 1
        ? `Sent successfully`
        : `Sent ${itemCount} ${noun}`;
    }

    if (actionLower.includes('create')) {
      return itemCount === 0
        ? `Nothing created`
        : itemCount === 1
        ? `Created successfully`
        : `Created ${itemCount} ${noun}`;
    }

    // Fallback: use step name and count
    if (itemCount === 0) {
      return 'Completed (no items)';
    }
    if (itemCount === 1) {
      return 'Completed successfully';
    }
    return `Processed ${itemCount} ${noun}`;
  }

  /**
   * Generate one-line summary from items
   * NO client data in summary
   */
  private static generateSummary(items: ExecutionResultItem[], totalItems: number): string {
    const successfulSteps = items.filter(i => i.status === 'success').length;
    const totalSteps = items.length;

    if (totalSteps === 0) {
      return 'Workflow completed with no steps';
    }

    if (totalItems === 0) {
      return `Completed ${successfulSteps}/${totalSteps} steps`;
    }

    return `Processed ${totalItems} items across ${successfulSteps}/${totalSteps} steps`;
  }
}

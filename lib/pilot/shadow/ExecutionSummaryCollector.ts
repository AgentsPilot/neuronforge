/**
 * ExecutionSummaryCollector
 *
 * Collects execution metadata during workflow runs for calibration summaries.
 * Uses plugin metadata to generate user-friendly descriptions WITHOUT any hardcoded logic.
 *
 * IMPORTANT: This collects aggregated counts ONLY - no actual client data or PII.
 */

import type { CalibrationExecutionSummary, DataSourceAccess, DataWritten } from '../types';
import * as fs from 'fs';
import * as path from 'path';

interface PluginActionMetadata {
  description: string;
  output_guidance?: {
    success_description?: string;
  };
}

/**
 * Load plugin definition from file system
 * Simple utility to avoid circular dependencies
 */
async function loadPluginDefinition(pluginName: string): Promise<any> {
  try {
    const definitionsDir = path.join(process.cwd(), 'lib', 'plugins', 'definitions');
    const fileName = `${pluginName}-plugin-v2.json`;
    const filePath = path.join(definitionsDir, fileName);

    const fileContent = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(fileContent);
  } catch (error) {
    console.warn(`[ExecutionSummaryCollector] Could not load plugin definition for ${pluginName}:`, error);
    return null;
  }
}

export class ExecutionSummaryCollector {
  private dataSourcesAccessed: Map<string, DataSourceAccess> = new Map();
  private dataWritten: Map<string, DataWritten> = new Map();
  private itemsProcessed: number = 0;
  private itemsFiltered: number = 0;
  private itemsDelivered: number = 0;

  /**
   * Record when data is read from a source
   */
  async recordDataRead(
    pluginName: string,
    actionName: string,
    count: number
  ): Promise<void> {
    const key = `${pluginName}:${actionName}`;

    // Get existing or create new entry
    const existing = this.dataSourcesAccessed.get(key);
    if (existing) {
      existing.count += count;
    } else {
      // Generate description from plugin metadata
      const description = await this.generateDescription(pluginName, actionName, count);

      this.dataSourcesAccessed.set(key, {
        plugin: pluginName,
        action: actionName,
        count,
        description
      });
    }
  }

  /**
   * Record when data is written to a destination
   */
  async recordDataWrite(
    pluginName: string,
    actionName: string,
    count: number
  ): Promise<void> {
    const key = `${pluginName}:${actionName}`;

    // Get existing or create new entry
    const existing = this.dataWritten.get(key);
    if (existing) {
      existing.count += count;
    } else {
      // Generate description from plugin metadata
      const description = await this.generateDescription(pluginName, actionName, count);

      this.dataWritten.set(key, {
        plugin: pluginName,
        action: actionName,
        count,
        description
      });
    }

    // Track items delivered
    this.itemsDelivered += count;
  }

  /**
   * Record items processed (went through the workflow)
   */
  recordItemsProcessed(count: number): void {
    this.itemsProcessed += count;
  }

  /**
   * Record items filtered (didn't match criteria)
   */
  recordItemsFiltered(count: number): void {
    this.itemsFiltered += count;
  }

  /**
   * Generate user-friendly description from plugin metadata
   * Uses the plugin definition's output_guidance.success_description field
   */
  private async generateDescription(
    pluginName: string,
    actionName: string,
    count: number
  ): Promise<string> {
    try {
      // Load plugin definition
      const pluginDef = await loadPluginDefinition(pluginName);

      if (!pluginDef || !pluginDef.actions || !pluginDef.actions[actionName]) {
        // Fallback to generic description if plugin not found
        return this.generateGenericDescription(actionName, count);
      }

      const actionMetadata = pluginDef.actions[actionName] as PluginActionMetadata;

      // Use output_guidance.success_description if available
      if (actionMetadata.output_guidance?.success_description) {
        // The success_description already contains user-friendly language
        // Just prepend with count if it's meaningful
        return `${actionMetadata.output_guidance.success_description}`;
      }

      // Fallback to action description if no success_description
      if (actionMetadata.description) {
        return actionMetadata.description;
      }

      // Final fallback to generic description
      return this.generateGenericDescription(actionName, count);

    } catch (error) {
      console.error(`[ExecutionSummaryCollector] Error loading plugin metadata for ${pluginName}.${actionName}:`, error);
      return this.generateGenericDescription(actionName, count);
    }
  }

  /**
   * Generate generic description as fallback
   * Uses action name only - no hardcoded logic
   */
  private generateGenericDescription(actionName: string, _count: number): string {
    // Convert snake_case to Title Case for readability
    const readableAction = actionName
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

    return readableAction;
  }

  /**
   * Get final execution summary
   */
  getSummary(): CalibrationExecutionSummary {
    return {
      data_sources_accessed: Array.from(this.dataSourcesAccessed.values()),
      data_written: Array.from(this.dataWritten.values()),
      items_processed: this.itemsProcessed,
      items_filtered: this.itemsFiltered > 0 ? this.itemsFiltered : undefined,
      items_delivered: this.itemsDelivered > 0 ? this.itemsDelivered : undefined
    };
  }

  /**
   * Reset collector for new execution
   */
  reset(): void {
    this.dataSourcesAccessed.clear();
    this.dataWritten.clear();
    this.itemsProcessed = 0;
    this.itemsFiltered = 0;
    this.itemsDelivered = 0;
  }
}

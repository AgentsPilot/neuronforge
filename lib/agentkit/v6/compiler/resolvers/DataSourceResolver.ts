/**
 * Data Source Resolver
 *
 * Maps IR data_sources to PILOT_DSL action steps.
 *
 * Responsibilities:
 * 1. Identify appropriate plugin for data source type
 * 2. Generate action step configuration
 * 3. Handle different data source types (tabular, API, webhook, etc.)
 */

import type { DataSource } from '../../logical-ir/schemas/extended-ir-types'
import type { WorkflowStep } from '../../../../pilot/types/pilot-dsl-types'
import { PluginResolver } from '../utils/PluginResolver'
import type { PluginManagerV2 } from '../../../../server/plugin-manager-v2'

// ============================================================================
// Data Source Resolver
// ============================================================================

export class DataSourceResolver {
  private pluginResolver: PluginResolver

  constructor(pluginManager?: PluginManagerV2) {
    this.pluginResolver = new PluginResolver(pluginManager)
  }

  /**
   * Resolve data sources to action steps
   */
  async resolve(dataSources: DataSource[], stepIdPrefix: string = 'read'): Promise<WorkflowStep[]> {
    console.log('[DataSourceResolver] Resolving', dataSources.length, 'data source(s)...')

    const steps: WorkflowStep[] = []

    for (let i = 0; i < dataSources.length; i++) {
      const dataSource = dataSources[i]
      console.log(`[DataSourceResolver] Processing data source ${i + 1}:`, dataSource.type, dataSource.location)

      const step = await this.resolveDataSource(dataSource, `${stepIdPrefix}_${i + 1}`)
      steps.push(step)
    }

    console.log('[DataSourceResolver] ✓ Resolved', steps.length, 'action step(s)')
    return steps
  }

  /**
   * Resolve a single data source to an action step
   */
  private async resolveDataSource(dataSource: DataSource, stepId: string): Promise<WorkflowStep> {
    switch (dataSource.type) {
      case 'tabular':
        return this.resolveTabularDataSource(dataSource, stepId)
      case 'api':
        return this.resolveAPIDataSource(dataSource, stepId)
      case 'webhook':
        return this.resolveWebhookDataSource(dataSource, stepId)
      case 'database':
        return this.resolveDatabaseDataSource(dataSource, stepId)
      case 'file':
        return this.resolveFileDataSource(dataSource, stepId)
      case 'stream':
        return this.resolveStreamDataSource(dataSource, stepId)
      default:
        throw new Error(`Unsupported data source type: ${(dataSource as any).type}`)
    }
  }

  /**
   * Resolve tabular data source (spreadsheets)
   */
  private resolveTabularDataSource(dataSource: DataSource, stepId: string): WorkflowStep {
    console.log('[DataSourceResolver] Resolving tabular data source:', dataSource.location)

    // Use PluginResolver to get actual plugin name and operation
    // Wave 8: Added try-catch for proper error propagation
    let resolution: { plugin_name: string; operation: string }
    try {
      resolution = this.pluginResolver.resolveTabularDataSource(dataSource.source)
    } catch (error: any) {
      throw new Error(`[DataSourceResolver] Failed to resolve tabular data source plugin for "${dataSource.source}": ${error.message}. Ensure spreadsheet plugin is available.`)
    }

    console.log(`[DataSourceResolver] ✓ Resolved to: ${resolution.plugin_name}.${resolution.operation}`)

    // Validate plugin and operation exist
    if (!this.pluginResolver.validatePluginOperation(resolution.plugin_name, resolution.operation)) {
      console.warn('[DataSourceResolver] ⚠ Plugin validation failed, proceeding anyway')
    }

    return {
      step_id: stepId,
      type: 'action',
      plugin: resolution.plugin_name,
      action: resolution.operation,  // Use 'action' for PILOT executor compatibility
      config: {
        spreadsheet_id: dataSource.location,
        range: dataSource.tab ? `${dataSource.tab}!A:Z` : 'A:Z',
        ...(dataSource.source && { source_hint: dataSource.source })
      },
      output_variable: dataSource.id,
      description: `Read data from ${dataSource.location}${dataSource.tab ? ` (${dataSource.tab})` : ''}`
    }
  }


  /**
   * Resolve API data source (schema-driven, no hardcoded plugin names)
   * Uses IR's plugin_key and operation_type when available
   */
  private resolveAPIDataSource(dataSource: DataSource, stepId: string): WorkflowStep {
    console.log('[DataSourceResolver] Resolving API data source:', dataSource.source, dataSource.location)

    // SCHEMA-DRIVEN: Use plugin_key and operation_type from IR when available
    const plugin = dataSource.plugin_key || dataSource.source || 'http-request'
    const operation = dataSource.operation_type || 'get'

    console.log(`[DataSourceResolver] ✓ Using IR-specified plugin: ${plugin}.${operation}`)

    // Use PluginResolver to find actual operation name if operation_type is generic
    // Wave 8: Added try-catch for proper error propagation
    let resolution: { plugin_name: string; operation: string }
    try {
      resolution = this.pluginResolver.resolveDataSource(plugin, operation as any)
    } catch (error: any) {
      throw new Error(`[DataSourceResolver] Failed to resolve API data source plugin "${plugin}.${operation}": ${error.message}. Ensure the plugin is available and the operation is supported.`)
    }

    // Build config from dataSource.config if available, otherwise construct generic config
    const config = dataSource.config || this.buildGenericAPIConfig(dataSource)

    return {
      step_id: stepId,
      type: 'action',
      plugin: resolution.plugin_name,
      action: resolution.operation,  // Use 'action' for PILOT executor compatibility
      config,
      output_variable: dataSource.id,
      description: `Fetch data from ${resolution.plugin_name}: ${dataSource.role || dataSource.location || 'API'}`
    }
  }

  /**
   * Build generic API config from data source (when no specific config provided)
   */
  private buildGenericAPIConfig(dataSource: DataSource): Record<string, any> {
    const config: Record<string, any> = {}

    // Add location/endpoint if available
    if (dataSource.location) {
      config.url = dataSource.location
    }
    if (dataSource.endpoint) {
      config.endpoint = dataSource.endpoint
    }

    // Add role as query hint if available
    if (dataSource.role) {
      config.query = dataSource.role
    }

    // Default method for HTTP
    if (!dataSource.plugin_key) {
      config.method = 'GET'
    }

    return config
  }

  /**
   * Resolve webhook data source
   */
  private resolveWebhookDataSource(dataSource: DataSource, stepId: string): WorkflowStep {
    console.log('[DataSourceResolver] Resolving webhook data source:', dataSource.trigger)

    return {
      step_id: stepId,
      type: 'trigger',
      plugin: 'webhook',
      operation: 'listen',
      config: {
        path: dataSource.location,
        trigger_name: dataSource.trigger || 'webhook_trigger'
      },
      output_variable: dataSource.id,
      description: `Listen for webhook: ${dataSource.trigger || dataSource.location}`
    }
  }

  /**
   * Resolve database data source
   */
  private resolveDatabaseDataSource(dataSource: DataSource, stepId: string): WorkflowStep {
    console.log('[DataSourceResolver] Resolving database data source:', dataSource.location)

    return {
      step_id: stepId,
      type: 'action',
      plugin: 'database',
      action: 'query',  // Use 'action' for PILOT executor compatibility
      config: {
        connection: dataSource.location,
        table: dataSource.tab || '',
        query_type: 'select'
      },
      output_variable: dataSource.id,
      description: `Query database: ${dataSource.location}`
    }
  }

  /**
   * Resolve file data source
   */
  private resolveFileDataSource(dataSource: DataSource, stepId: string): WorkflowStep {
    console.log('[DataSourceResolver] Resolving file data source:', dataSource.location)

    return {
      step_id: stepId,
      type: 'action',
      plugin: 'file-system',
      action: 'read',  // Use 'action' for PILOT executor compatibility
      config: {
        path: dataSource.location,
        format: this.detectFileFormat(dataSource.location)
      },
      output_variable: dataSource.id,
      description: `Read file: ${dataSource.location}`
    }
  }

  /**
   * Resolve stream data source
   */
  private resolveStreamDataSource(dataSource: DataSource, stepId: string): WorkflowStep {
    console.log('[DataSourceResolver] Resolving stream data source:', dataSource.location)

    return {
      step_id: stepId,
      type: 'action',
      plugin: 'stream',
      action: 'subscribe',  // Use 'action' for PILOT executor compatibility
      config: {
        stream_url: dataSource.location,
        source: dataSource.source || 'generic'
      },
      output_variable: dataSource.id,
      description: `Subscribe to stream: ${dataSource.location}`
    }
  }

  /**
   * Detect file format from filename
   */
  private detectFileFormat(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase()

    switch (ext) {
      case 'csv':
        return 'csv'
      case 'json':
        return 'json'
      case 'txt':
        return 'text'
      case 'pdf':
        return 'pdf'
      case 'xlsx':
      case 'xls':
        return 'excel'
      default:
        return 'auto'
    }
  }

  /**
   * Get output variable name for a data source
   */
  getOutputVariable(dataSource: DataSource): string {
    return dataSource.id
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a data source resolver
 */
export function createDataSourceResolver(pluginManager?: PluginManagerV2): DataSourceResolver {
  return new DataSourceResolver(pluginManager)
}

/**
 * Quick resolve function
 */
export async function resolveDataSources(
  dataSources: DataSource[],
  pluginManager?: PluginManagerV2
): Promise<WorkflowStep[]> {
  const resolver = new DataSourceResolver(pluginManager)
  return await resolver.resolve(dataSources)
}

/**
 * Delivery Resolver
 *
 * Maps IR delivery methods to PILOT_DSL action steps.
 *
 * Responsibilities:
 * 1. Convert delivery configurations to action steps
 * 2. Handle different delivery methods (email, Slack, webhook, etc.)
 * 3. Resolve recipient sources and dynamic content
 */

import type { Delivery, DeliveryMethod } from '../../logical-ir/schemas/extended-ir-types'
import type { WorkflowStep } from '../../../../pilot/types/pilot-dsl-types'
import { PluginResolver } from '../utils/PluginResolver'
import type { PluginManagerV2 } from '../../../../server/plugin-manager-v2'

// ============================================================================
// Delivery Resolver
// ============================================================================

export class DeliveryResolver {
  private pluginResolver: PluginResolver

  constructor(pluginManager?: PluginManagerV2) {
    this.pluginResolver = new PluginResolver(pluginManager)
  }

  /**
   * Resolve delivery methods to action steps
   */
  async resolve(
    deliveryMethods: Delivery[],
    inputVariable: string,
    stepIdPrefix: string = 'deliver'
  ): Promise<WorkflowStep[]> {
    console.log('[DeliveryResolver] Resolving', deliveryMethods.length, 'delivery method(s)...')

    const steps: WorkflowStep[] = []

    for (let i = 0; i < deliveryMethods.length; i++) {
      const delivery = deliveryMethods[i]
      console.log(`[DeliveryResolver] Processing delivery ${i + 1}:`, delivery.method)

      const step = await this.createDeliveryStep(delivery, inputVariable, `${stepIdPrefix}_${i + 1}`)
      steps.push(step)
    }

    console.log('[DeliveryResolver] ✓ Resolved', steps.length, 'delivery step(s)')
    return steps
  }

  /**
   * Create a delivery step
   */
  private async createDeliveryStep(
    delivery: Delivery,
    inputVariable: string,
    stepId: string
  ): Promise<WorkflowStep> {
    switch (delivery.method) {
      case 'email':
        return this.createEmailStep(delivery, inputVariable, stepId)
      case 'slack':
        return this.createSlackStep(delivery, inputVariable, stepId)
      case 'webhook':
        return this.createWebhookStep(delivery, inputVariable, stepId)
      case 'database':
        return this.createDatabaseStep(delivery, inputVariable, stepId)
      case 'api_call':
        return this.createAPIStep(delivery, inputVariable, stepId)
      case 'file':
        return this.createFileStep(delivery, inputVariable, stepId)
      case 'sms':
        return this.createSMSStep(delivery, inputVariable, stepId)
      default:
        throw new Error(`Unsupported delivery method: ${(delivery as any).method}`)
    }
  }

  /**
   * Create email delivery step
   */
  private createEmailStep(delivery: Delivery, inputVariable: string, stepId: string): WorkflowStep {
    const config = delivery.config

    // Use PluginResolver to get actual plugin name and operation
    // Wave 8: Added try-catch for proper error propagation
    let resolution: { plugin_name: string; operation: string }
    try {
      resolution = this.pluginResolver.resolveEmailDelivery()
    } catch (error: any) {
      throw new Error(`[DeliveryResolver] Failed to resolve email delivery plugin: ${error.message}. Ensure email plugin is available.`)
    }

    console.log(`[DeliveryResolver] ✓ Resolved email to: ${resolution.plugin_name}.${resolution.operation}`)

    // Validate plugin and operation exist
    if (!this.pluginResolver.validatePluginOperation(resolution.plugin_name, resolution.operation)) {
      console.warn('[DeliveryResolver] ⚠ Plugin validation failed, proceeding anyway')
    }

    // Build recipients object in the format expected by email plugins
    const recipients: any = {}

    if (config.recipient) {
      recipients.to = Array.isArray(config.recipient) ? config.recipient : [config.recipient]
    } else if (config.recipient_source) {
      // Dynamic recipient from variable
      recipients.to = [`{{${this.extractVariableName(config.recipient_source)}}}`]
    }

    if (config.cc && config.cc.length > 0) {
      recipients.cc = config.cc
    }

    if (config.bcc && config.bcc.length > 0) {
      recipients.bcc = config.bcc
    }

    // Build content object
    // Replace any undefined template variables in body with the input variable
    const sanitizedBody = config.body
      ? this.sanitizeTemplateVariables(config.body, inputVariable)
      : `{{${inputVariable}}}`

    const content: any = {
      subject: config.subject || 'Workflow Results',
      body: sanitizedBody
    }

    // Many email plugins support HTML body (Gmail, Outlook, etc.)
    // Include it when available - plugins that don't support it will ignore it
    if (config.body) {
      content.html_body = sanitizedBody
    }

    return {
      step_id: stepId,
      type: 'action',
      plugin: resolution.plugin_name,
      action: resolution.operation,  // Use 'action' for PILOT executor compatibility
      config: {
        recipients,
        content,
        data_source: `{{${inputVariable}}}`
      },
      output_variable: `${stepId}_result`,
      description: `Send email${config.recipient ? ` to ${config.recipient}` : ''}${config.recipient_source ? ` to {{${this.extractVariableName(config.recipient_source)}}}` : ''}`
    }
  }

  /**
   * Create Slack delivery step
   */
  private createSlackStep(delivery: Delivery, inputVariable: string, stepId: string): WorkflowStep {
    const config = delivery.config

    // Use PluginResolver to get actual operation name
    // Wave 8: Added try-catch for proper error propagation
    let resolution: { plugin_name: string; operation: string }
    try {
      resolution = this.pluginResolver.resolveSlackDelivery()
    } catch (error: any) {
      throw new Error(`[DeliveryResolver] Failed to resolve Slack delivery plugin: ${error.message}. Ensure Slack plugin is available.`)
    }

    console.log(`[DeliveryResolver] ✓ Resolved Slack to: ${resolution.plugin_name}.${resolution.operation}`)

    return {
      step_id: stepId,
      type: 'action',
      plugin: resolution.plugin_name,
      action: resolution.operation,  // Use 'action' for PILOT executor compatibility
      config: {
        channel: config.channel,
        message: config.message || `{{${inputVariable}}}`,
        data_source: `{{${inputVariable}}}`
      },
      output_variable: `${stepId}_result`,
      description: `Send Slack message to ${config.channel}`
    }
  }

  /**
   * Create webhook delivery step
   * Schema-driven: Uses PluginResolver to find HTTP plugin by capability
   */
  private createWebhookStep(delivery: Delivery, inputVariable: string, stepId: string): WorkflowStep {
    const config = delivery.config

    // Use PluginResolver to find HTTP/webhook plugin by capability
    const pluginName = this.pluginResolver.resolveDeliveryMethodToPlugin('webhook')
    const resolution = this.pluginResolver.resolveDelivery(pluginName, 'post')

    console.log(`[DeliveryResolver] ✓ Resolved webhook to: ${resolution.plugin_name}.${resolution.operation}`)

    return {
      step_id: stepId,
      type: 'action',
      plugin: resolution.plugin_name,
      action: resolution.operation,  // Use 'action' for PILOT executor compatibility
      config: {
        url: config.url,
        endpoint: config.endpoint || '',
        method: config.method || 'POST',
        headers: config.headers || { 'Content-Type': 'application/json' },
        payload: config.payload || `{{${inputVariable}}}`
      },
      output_variable: `${stepId}_result`,
      description: `Send webhook to ${config.url}${config.endpoint || ''}`
    }
  }

  /**
   * Create database delivery step
   * Schema-driven: Uses PluginResolver to find database plugin by capability
   */
  private createDatabaseStep(delivery: Delivery, inputVariable: string, stepId: string): WorkflowStep {
    const config = delivery.config
    const operationType = config.operation || 'insert'

    // Use PluginResolver to find database plugin by capability
    const pluginName = this.pluginResolver.resolveDeliveryMethodToPlugin('database')
    const resolution = this.pluginResolver.resolveDelivery(pluginName, operationType as any)

    console.log(`[DeliveryResolver] ✓ Resolved database to: ${resolution.plugin_name}.${resolution.operation}`)

    return {
      step_id: stepId,
      type: 'action',
      plugin: resolution.plugin_name,
      action: resolution.operation,  // Use 'action' for PILOT executor compatibility
      config: {
        table: config.table,
        data: `{{${inputVariable}}}`,
        operation_type: operationType
      },
      output_variable: `${stepId}_result`,
      description: `${operationType.charAt(0).toUpperCase() + operationType.slice(1)} to database table ${config.table}`
    }
  }

  /**
   * Create API call delivery step
   * Schema-driven: Uses PluginResolver to find HTTP plugin by capability
   */
  private createAPIStep(delivery: Delivery, inputVariable: string, stepId: string): WorkflowStep {
    const config = delivery.config

    // Use PluginResolver to find HTTP plugin by capability
    const pluginName = this.pluginResolver.resolveDeliveryMethodToPlugin('api_call')
    const resolution = this.pluginResolver.resolveDelivery(pluginName, 'post')

    console.log(`[DeliveryResolver] ✓ Resolved API call to: ${resolution.plugin_name}.${resolution.operation}`)

    return {
      step_id: stepId,
      type: 'action',
      plugin: resolution.plugin_name,
      action: resolution.operation,  // Use 'action' for PILOT executor compatibility
      config: {
        url: config.url,
        endpoint: config.endpoint || '',
        method: config.method || 'POST',
        headers: config.headers || {},
        payload: config.payload || `{{${inputVariable}}}`
      },
      output_variable: `${stepId}_result`,
      description: `Call API: ${config.method || 'POST'} ${config.url}${config.endpoint || ''}`
    }
  }

  /**
   * Create file delivery step
   * Schema-driven: Uses PluginResolver to find file plugin by capability
   */
  private createFileStep(delivery: Delivery, inputVariable: string, stepId: string): WorkflowStep {
    const config = delivery.config

    // Use PluginResolver to find file system plugin by capability
    const pluginName = this.pluginResolver.resolveDeliveryMethodToPlugin('file')
    const resolution = this.pluginResolver.resolveDelivery(pluginName, 'send')

    console.log(`[DeliveryResolver] ✓ Resolved file to: ${resolution.plugin_name}.${resolution.operation}`)

    return {
      step_id: stepId,
      type: 'action',
      plugin: resolution.plugin_name,
      action: resolution.operation,  // Use 'action' for PILOT executor compatibility
      config: {
        path: config.path,
        format: config.format || 'json',
        data: `{{${inputVariable}}}`
      },
      output_variable: `${stepId}_result`,
      description: `Save to file: ${config.path}`
    }
  }

  /**
   * Create SMS delivery step
   * Schema-driven: Uses PluginResolver to find SMS plugin by capability
   */
  private createSMSStep(delivery: Delivery, inputVariable: string, stepId: string): WorkflowStep {
    const config = delivery.config

    // Use PluginResolver to find SMS plugin by capability
    const pluginName = this.pluginResolver.resolveDeliveryMethodToPlugin('sms')
    const resolution = this.pluginResolver.resolveDelivery(pluginName, 'send')

    console.log(`[DeliveryResolver] ✓ Resolved SMS to: ${resolution.plugin_name}.${resolution.operation}`)

    return {
      step_id: stepId,
      type: 'action',
      plugin: resolution.plugin_name,
      action: resolution.operation,  // Use 'action' for PILOT executor compatibility
      config: {
        recipient: config.recipient,
        recipient_source: config.recipient_source,
        message: config.message || `{{${inputVariable}}}`
      },
      output_variable: `${stepId}_result`,
      description: `Send SMS${config.recipient ? ` to ${config.recipient}` : ''}`
    }
  }

  /**
   * Extract variable name from {{variable}} or just return the string
   */
  private extractVariableName(source: string): string {
    if (!source) return source
    const match = source.match(/\{\{([^}]+)\}\}/)
    return match ? match[1] : source
  }

  /**
   * Sanitize template variables in body text
   * Replaces undefined template variables with a single workflow data variable
   */
  private sanitizeTemplateVariables(body: string, fallbackVariable: string): string {
    // Check if body contains any template variables
    const hasTemplateVars = /\{\{[^}]+\}\}/.test(body)

    if (!hasTemplateVars) {
      // No template variables, just return the body as-is
      return body
    }

    // If body has template variables but they're likely undefined runtime metadata
    // (like {{emails_scanned}}, {{summary}}, etc.), replace the entire body
    // with the workflow output variable
    const metadataVars = ['emails_scanned', 'pdfs_processed', 'rows_extracted',
                         'rows_need_review', 'summary', 'count', 'total']

    const hasOnlyMetadata = metadataVars.some(meta => body.includes(`{{${meta}}}`))

    if (hasOnlyMetadata) {
      // Replace body with rendered output and a note
      return `Workflow results:\n\n{{${fallbackVariable}}}`
    }

    return body
  }

  /**
   * Check if delivery uses dynamic recipient
   */
  isDynamicRecipient(delivery: Delivery): boolean {
    return delivery.config.recipient_source !== undefined
  }

  /**
   * Get recipient for a delivery
   */
  getRecipient(delivery: Delivery): string | string[] | undefined {
    return delivery.config.recipient || delivery.config.recipient_source
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a delivery resolver
 */
export function createDeliveryResolver(pluginManager?: PluginManagerV2): DeliveryResolver {
  return new DeliveryResolver(pluginManager)
}

/**
 * Quick resolve deliveries
 */
export async function resolveDeliveries(
  deliveries: Delivery[],
  inputVariable: string,
  pluginManager?: PluginManagerV2
): Promise<WorkflowStep[]> {
  const resolver = new DeliveryResolver(pluginManager)
  return await resolver.resolve(deliveries, inputVariable)
}

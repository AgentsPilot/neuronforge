/**
 * IRFormalizer - Maps Grounded Semantic Plan to Precise IR
 *
 * This is the FORMALIZATION PHASE (not understanding, not reasoning).
 * Takes a grounded semantic plan (with validated assumptions and resolved field names)
 * and mechanically maps it to the strict IR schema.
 *
 * Key Principles:
 * 1. Use grounded facts EXACTLY (no modifications)
 * 2. Mechanical mapping (no reasoning)
 * 3. Follow IR schema strictly
 * 4. Handle missing facts gracefully
 */

import OpenAI from 'openai'
import type { GroundedSemanticPlan } from './schemas/semantic-plan-types'
import type { DeclarativeLogicalIR } from '../logical-ir/schemas/declarative-ir-types'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { PluginManagerV2 } from '../../../server/plugin-manager-v2'

export interface IRFormalizerConfig {
  model?: string
  temperature?: number
  max_tokens?: number
  openai_api_key?: string
  pluginManager?: PluginManagerV2
  servicesInvolved?: string[] // From Enhanced Prompt specifics.services_involved
}

export interface FormalizationResult {
  ir: DeclarativeLogicalIR
  formalization_metadata: {
    provider: string
    model: string
    grounded_facts_used: Record<string, any>
    missing_facts: string[]
    formalization_confidence: number
    timestamp: string
  }
}

export class IRFormalizer {
  private config: {
    model: string
    temperature: number
    max_tokens: number
    openai_api_key: string
    pluginManager?: PluginManagerV2
    servicesInvolved?: string[]
  }
  private openai: OpenAI
  private systemPrompt: string
  private pluginManager?: PluginManagerV2
  private groundedPlan?: any  // Store current grounded plan for plugin extraction
  private servicesInvolved?: string[]  // From Enhanced Prompt

  constructor(config: IRFormalizerConfig) {
    this.config = {
      model: config.model || 'gpt-5.2',
      temperature: config.temperature ?? 0.0, // Very low - this is mechanical mapping
      max_tokens: config.max_tokens ?? 4000,
      openai_api_key: config.openai_api_key || process.env.OPENAI_API_KEY || '',
      pluginManager: config.pluginManager,
      servicesInvolved: config.servicesInvolved
    }

    this.pluginManager = config.pluginManager
    this.servicesInvolved = config.servicesInvolved

    // Initialize OpenAI client
    this.openai = new OpenAI({ apiKey: this.config.openai_api_key })

    // Load formalization system prompt
    // Use process.cwd() instead of __dirname for Next.js compatibility
    const promptPath = join(process.cwd(), 'lib', 'agentkit', 'v6', 'semantic-plan', 'prompts', 'formalization-system.md')
    this.systemPrompt = readFileSync(promptPath, 'utf-8')

    console.log('[IRFormalizer] Loaded formalization system prompt from:', promptPath)
    console.log('[IRFormalizer] System prompt length:', this.systemPrompt.length)
  }

  /**
   * Formalize a grounded semantic plan to IR
   */
  async formalize(groundedPlan: GroundedSemanticPlan): Promise<FormalizationResult> {
    console.log('[IRFormalizer] Starting formalization...')

    // Store grounded plan for plugin extraction
    this.groundedPlan = groundedPlan

    // Extract grounded facts
    const groundedFacts = this.extractGroundedFacts(groundedPlan)
    const missingFacts = this.identifyMissingFacts(groundedPlan)

    console.log(`[IRFormalizer] Grounded facts: ${Object.keys(groundedFacts).length}`)
    console.log(`[IRFormalizer] Missing facts: ${missingFacts.length}`)

    if (missingFacts.length > 0) {
      console.warn(`[IRFormalizer] WARNING: Missing grounded facts:`, missingFacts)
    }

    // Build formalization request
    const userMessage = this.buildFormalizationRequest(groundedPlan, groundedFacts)

    // Debug: Log the available plugins section
    if (process.env.DEBUG_IR_FORMALIZER === 'true') {
      console.log('[IRFormalizer] DEBUG: User message length:', userMessage.length)
      console.log('[IRFormalizer] DEBUG: First 2000 chars of user message:')
      console.log(userMessage.substring(0, 2000))
    }

    // Call OpenAI LLM
    const ir = await this.formalizeWithOpenAI(userMessage)

    // Ensure goal field is present (required by schema but sometimes omitted by LLM)
    if (!ir.goal) {
      ir.goal = groundedPlan.goal
      console.log('[IRFormalizer] Added missing goal field from grounded plan')
    }

    // CRITICAL FIX: Wire up validateFormalization() - was never called before!
    const validation = this.validateFormalization(ir, groundedFacts)
    if (!validation.valid) {
      console.error('[IRFormalizer] ✗ Formalization validation failed:', validation.errors)
      throw new Error(`Formalization validation failed: ${validation.errors.join(', ')}`)
    }
    if (validation.warnings.length > 0) {
      console.warn('[IRFormalizer] ⚠ Formalization warnings:', validation.warnings)
    }

    console.log('[IRFormalizer] ✓ Formalization complete and validated')

    // Calculate confidence based on grounded facts usage
    const formalizationConfidence = this.calculateFormalizationConfidence(
      groundedPlan,
      groundedFacts,
      missingFacts
    )

    return {
      ir,
      formalization_metadata: {
        provider: 'openai',
        model: this.config.model,
        grounded_facts_used: groundedFacts,
        missing_facts: missingFacts,
        formalization_confidence: formalizationConfidence,
        timestamp: new Date().toISOString()
      }
    }
  }

  /**
   * Extract grounded facts from validation results
   *
   * Returns validated assumptions as key-value pairs.
   * Logs warnings when grounding results are empty or all validations failed.
   */
  private extractGroundedFacts(groundedPlan: GroundedSemanticPlan): Record<string, any> {
    const facts: Record<string, any> = {}

    // Check if grounding_results exists and has entries
    if (!groundedPlan.grounding_results || groundedPlan.grounding_results.length === 0) {
      console.warn('[IRFormalizer] ⚠️ No grounding_results in groundedPlan - formalization will proceed without grounded facts')
      console.warn('[IRFormalizer] This may indicate an API-only workflow (no tabular metadata) or a grounding failure')
      return facts
    }

    for (const result of groundedPlan.grounding_results) {
      if (result.validated && result.resolved_value !== null) {
        facts[result.assumption_id] = result.resolved_value
      }
    }

    // Warn if no facts were extracted despite having grounding results
    if (Object.keys(facts).length === 0) {
      console.warn('[IRFormalizer] ⚠️ All grounding_results failed validation - no grounded facts available')
      console.warn('[IRFormalizer] Formalization will rely on LLM inference for field names (may be less accurate)')
      console.warn('[IRFormalizer] Failed assumptions:', groundedPlan.grounding_results.map(r => r.assumption_id).join(', '))
    } else {
      console.log('[IRFormalizer] ✓ Extracted', Object.keys(facts).length, 'grounded facts:', Object.keys(facts).join(', '))
    }

    return facts
  }

  /**
   * Identify assumptions that failed validation
   */
  private identifyMissingFacts(groundedPlan: GroundedSemanticPlan): string[] {
    const missing: string[] = []

    for (const result of groundedPlan.grounding_results) {
      if (!result.validated || result.resolved_value === null) {
        missing.push(result.assumption_id)
      }
    }

    return missing
  }

  /**
   * Build formalization request message
   */
  private buildFormalizationRequest(
    groundedPlan: GroundedSemanticPlan,
    groundedFacts: Record<string, any>
  ): string {
    // Get available plugins if plugin manager is provided
    const availablePluginsSection = this.buildAvailablePluginsSection()

    // Check if semantic understanding has search criteria (indicates plugin query needed)
    const hasSearchCriteria = this.detectSearchCriteria(groundedPlan.understanding)

    const searchCriteriaInstructions = hasSearchCriteria ? `

## SPECIAL INSTRUCTION: Search Criteria Handling

The semantic understanding includes search_criteria or filter conditions.

**Follow these rules**:
1. **Time-based filters** (newer_than:7d, older_than:30d, etc.) → Use data_source.config.query
2. **Keyword/text matching** (subject contains "complaint", etc.) → Use IR.filters with "contains" operator
3. **Complex AND/OR logic** → Use IR.filters.groups structure

**Example - Gmail with time filter + keyword matching:**
\`\`\`json
{
  "data_sources": [{
    "plugin_key": "google-mail",
    "operation_type": "search",
    "config": {
      "query": "newer_than:7d",
      "max_results": 100
    }
  }],
  "filters": {
    "combineWith": "OR",
    "conditions": [],
    "groups": [
      {
        "combineWith": "OR",
        "conditions": [
          {"field": "subject", "operator": "contains", "value": "complaint"},
          {"field": "subject", "operator": "contains", "value": "angry"}
        ]
      }
    ]
  }
}
\`\`\`
` : ''

    return `# Formalization Request

You must map this grounded semantic plan to precise IR.

## Grounded Facts (USE THESE EXACTLY)

\`\`\`json
${JSON.stringify(groundedFacts, null, 2)}
\`\`\`

## Semantic Understanding (Map to IR Structure)

\`\`\`json
${JSON.stringify(groundedPlan.understanding, null, 2)}
\`\`\`
${searchCriteriaInstructions}
${availablePluginsSection}

## Original Goal

${groundedPlan.goal}

## Reasoning Trace (for context only, do not re-reason)

${groundedPlan.reasoning_trace.map(t => `Step ${t.step}: ${t.choice_made} - ${t.reasoning}`).join('\n')}

## Your Task

Map the semantic understanding to IR structure.

**Critical Rules:**
1. Use grounded facts exactly as provided (no modifications) - these are for TABULAR data sources
2. Follow IR schema enum values strictly
3. Map semantic concepts to IR structure mechanically
4. **ALWAYS populate plugin_key and operation_type with actual values (NEVER null)**
5. **CRITICAL FILTERING RULE**:
   - For time-based filters (newer_than:7d, etc.) → use config.query
   - For keyword/text matching → ALWAYS use IR filters with "contains" operator
   - For complex AND/OR logic → use IR filters.groups structure
   - IR filters work on ALL data sources (tabular AND API) - use them for keyword matching

6. **CRITICAL: FILTER FIELD NAMES FOR API SOURCES (MOST IMPORTANT!)**:
   - For API data sources (google-mail, slack, etc.), grounded facts DO NOT contain filter field names
   - You MUST look up the **Output Fields** in the "Available Plugins" section above
   - Find the plugin and action being used (e.g., google-mail → search_emails)
   - Copy the EXACT field name from "Output Fields" (e.g., "snippet", "subject", "from", "body")
   - NEVER use null for filter field names - ALWAYS populate with actual field name from Output Fields
   - NEVER invent semantic names like "email_content_text" - use ONLY names from Output Fields
   - Example: If filtering Gmail for complaints, use "snippet" or "body" (from Output Fields), NOT null

Output ONLY the IR JSON (no explanations, no markdown).`
  }

  /**
   * Detect if semantic understanding includes search criteria that should use plugin queries
   */
  private detectSearchCriteria(understanding: any): boolean {
    if (!understanding) {
      return false
    }

    // CRITICAL: Check if filtering section exists (keyword matching, etc.)
    if (understanding.filtering && understanding.filtering.conditions) {
      console.log('[IRFormalizer] ✅ Detected filtering section with conditions - will inject filter instructions')
      return true
    }

    // Check if any data source has search_criteria
    if (understanding.data_sources && Array.isArray(understanding.data_sources)) {
      for (const ds of understanding.data_sources) {
        if (ds.search_criteria || ds.time_window || ds.query) {
          return true
        }
      }
    }

    // Check if it's an API plugin (type indicates it supports queries)
    if (understanding.data_sources && Array.isArray(understanding.data_sources)) {
      for (const ds of understanding.data_sources) {
        if (ds.type === 'api') {
          return true
        }
      }
    }

    return false
  }

  /**
   * Get plugin keys from Enhanced Prompt services_involved (simple, no guessing!)
   */
  private extractUsedPluginsFromSemanticPlan(plan: any): string[] {
    // Use services_involved directly from Enhanced Prompt if available
    if (this.servicesInvolved && this.servicesInvolved.length > 0) {
      console.log(`[IRFormalizer] Using services_involved from Enhanced Prompt: ${this.servicesInvolved.join(', ')}`)
      return this.servicesInvolved
    }

    // Fallback: If no services_involved, inject all plugins
    console.log('[IRFormalizer] No services_involved provided, will inject all plugins')
    return []
  }

  /**
   * Build available plugins section for formalization request
   * OPTIMIZED: Only inject plugins that are actually used in the semantic plan
   */
  private buildAvailablePluginsSection(): string {
    if (!this.pluginManager) {
      return ''
    }

    const availablePlugins = this.pluginManager.getAvailablePlugins()

    // Extract only used plugins from semantic plan
    const usedPluginKeys = this.extractUsedPluginsFromSemanticPlan(this.groundedPlan)

    if (usedPluginKeys.length === 0) {
      console.log('[IRFormalizer] ⚠️ No plugins detected in semantic plan, injecting all plugins')
      // Fallback to all plugins if extraction fails
    } else {
      console.log(`[IRFormalizer] ✓ Injecting only used plugins: ${usedPluginKeys.join(', ')} (${usedPluginKeys.length} of ${Object.keys(availablePlugins).length})`)
    }

    // Filter to only used plugins (or all if extraction failed)
    const pluginsToInject = usedPluginKeys.length > 0
      ? usedPluginKeys
        .map(key => ({ key, def: availablePlugins[key] }))
        .filter(p => p.def) // Only include plugins that exist
      : Object.entries(availablePlugins).map(([key, def]) => ({ key, def }))

    // Build detailed plugin information including parameter schemas AND output schemas
    const pluginDetails = pluginsToInject.map(({ key, def: pluginDef }) => {
      const description = pluginDef.plugin?.description || 'No description'

      // List actions with their critical parameters AND output fields
      const actionsList = Object.entries(pluginDef.actions).map(([actionName, actionDef]) => {
        const params = (actionDef as any).parameters
        const outputSchema = (actionDef as any).output_schema

        // Build parameter info - include both description AND usage_context for better action selection
        const actionDescription = (actionDef as any).description || 'No description'
        const usageContext = (actionDef as any).usage_context
        let paramInfo = `    - ${actionName}: ${actionDescription}`
        if (usageContext) {
          paramInfo += `\n      Usage: ${usageContext}`
        }

        if (params && params.properties) {
          // Extract key parameters (especially query-like parameters)
          const keyParams: string[] = []
          for (const [paramName, paramDef] of Object.entries(params.properties as Record<string, any>)) {
            // Show query, search, filter-like parameters prominently
            if (paramName.includes('query') || paramName.includes('search') || paramName.includes('filter') || params.required?.includes(paramName)) {
              const paramDesc = paramDef.description || ''
              const paramType = paramDef.type || 'any'
              const isRequired = params.required?.includes(paramName) ? ' (required)' : ''
              const defaultValue = paramDef.default !== undefined ? ` [default: "${paramDef.default}"]` : ''
              keyParams.push(`      • ${paramName} (${paramType})${isRequired}${defaultValue}: ${paramDesc}`)
            }
          }

          if (keyParams.length > 0) {
            paramInfo += `\n${keyParams.join('\n')}`
          }
        }

        // Extract output fields from output_schema (CRITICAL for filter field names!)
        if (outputSchema) {
          const outputFields: string[] = []

          // Helper to extract fields from a properties object
          const extractFieldsFromProperties = (props: Record<string, any>) => {
            for (const [fieldName, fieldDef] of Object.entries(props)) {
              const fieldType = fieldDef.type || 'any'
              const fieldDesc = fieldDef.description || ''
              outputFields.push(`      • ${fieldName} (${fieldType}): ${fieldDesc}`)
            }
          }

          // Case 1: Direct array of items (e.g., type: "array", items: { properties: {...} })
          if (outputSchema.type === 'array' && outputSchema.items?.properties) {
            extractFieldsFromProperties(outputSchema.items.properties)
          }
          // Case 2: Object with nested array property (e.g., Gmail: { properties: { emails: { type: "array", items: {...} } } })
          else if (outputSchema.type === 'object' && outputSchema.properties) {
            // Look for the main array property (typically named "emails", "items", "results", "data", etc.)
            for (const [propName, propDef] of Object.entries(outputSchema.properties as Record<string, any>)) {
              if (propDef.type === 'array' && propDef.items?.properties) {
                // Found the main data array - extract its item fields
                extractFieldsFromProperties(propDef.items.properties)
                break // Use the first array property found (typically the main data)
              }
            }
            // If no nested array found, fall back to extracting top-level properties
            if (outputFields.length === 0) {
              extractFieldsFromProperties(outputSchema.properties)
            }
          }

          if (outputFields.length > 0) {
            paramInfo += `\n      **Output Fields (use these EXACT names in filters and rendering.columns_in_order):**\n${outputFields.join('\n')}`
          }
        }

        return paramInfo
      }).join('\n')

      return `- **${key}**: ${description}\n  Actions:\n${actionsList}`
    }).join('\n\n')

    if (pluginDetails.length === 0) {
      return ''
    }

    return `## Available Plugins (Use these plugin_key values)

${pluginDetails}

**CRITICAL INSTRUCTIONS - READ CAREFULLY:**

1. **Plugin Selection**: Use the exact plugin_key from the list above

2. **Operation Type Selection** (MOST CRITICAL):
   - For EVERY data_source and delivery_rule, you MUST set operation_type
   - operation_type MUST be an EXACT action name from the "Actions:" list of the chosen plugin
   - Find the plugin in the list above, look at its "Actions:" section
   - Copy the action name EXACTLY character-for-character
   - DO NOT infer, abbreviate, or create operation types - ONLY use listed action names
   - **APPEND vs WRITE distinction**: If the goal is to ADD rows/records to existing data, use an "append" or "add" action. If the goal is to OVERWRITE/REPLACE existing data, use a "write" action.
   - Example flow:
     * Chosen plugin_key: Look up in Available Plugins above
     * See its "Actions:" list
     * Choose the action that matches the intent (append for adding, write for replacing)
     * Set operation_type to EXACT match of the chosen action name

3. **Config Parameters**:
   - Look at the parameters listed under the chosen action
   - Populate config object with required/relevant parameters from the action's parameter list
   - Use semantic understanding to fill parameter values

4. **Parameter Value Population**:
   - If an action has "query" or "search" parameters, populate from semantic understanding
   - DO NOT leave required parameters empty

5. **Filter Field Names** (CRITICAL FOR FILTERING):
   - When creating filters.conditions[], the "field" property MUST use EXACT field names from "Output Fields"
   - Find the plugin/action that provides the data you're filtering
   - Look at its "Output Fields" section
   - Copy the field name EXACTLY character-for-character
   - DO NOT invent semantic names like "email_content_text" or "sender_email"
   - DO NOT use camelCase if the schema uses snake_case (or vice versa)
   - Example:
     * Filtering Gmail results for keyword in body
     * Look up google-mail plugin → search_emails action
     * See Output Fields: id, subject, from, snippet, body, date, etc.
     * Use EXACT field name: "snippet" or "body" (NOT "email_content_text")
     * filters.conditions[0].field = "snippet"
   - If unsure which field to use, prefer simpler fields like "snippet" over "body"
`
  }

  /**
   * Call LLM with timeout protection
   * Returns AbortController to allow cleanup
   */
  private async callWithTimeout<T>(
    apiCall: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    let timeoutId: NodeJS.Timeout | null = null

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Request timeout after ${timeoutMs}ms`))
      }, timeoutMs)
    })

    try {
      const result = await Promise.race([apiCall, timeoutPromise])
      if (timeoutId) clearTimeout(timeoutId)
      return result
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId)
      throw error
    }
  }

  /**
   * Formalize using OpenAI with timeout protection
   */
  private async formalizeWithOpenAI(userMessage: string): Promise<DeclarativeLogicalIR> {
    console.log('[IRFormalizer] Calling OpenAI...')
    console.log(`[IRFormalizer] Model: ${this.config.model}`)

    const apiCall = this.openai.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: userMessage }
      ],
      response_format: { type: 'json_object' }, // Use json_object for gpt-5.2 compatibility
      temperature: this.config.temperature,
      max_completion_tokens: this.config.max_tokens
    })

    // Wrap with 90-second timeout (complex workflows need more time)
    const response = await this.callWithTimeout(apiCall, 90000)

    const content = response.choices[0]?.message?.content

    if (!content) {
      throw new Error('No response content from OpenAI')
    }

    const ir = JSON.parse(content) as DeclarativeLogicalIR

    // Fix type coercion: LLM sometimes outputs numeric strings instead of numbers
    this.coerceIRTypes(ir)

    console.log('[IRFormalizer] OpenAI response parsed successfully')

    return ir
  }

  /**
   * Coerce IR types: LLM sometimes outputs strings instead of numbers
   * Fix temperature, max_tokens, and other numeric fields
   */
  private coerceIRTypes(ir: DeclarativeLogicalIR): void {
    // Fix ai_operations constraints (temperature, max_tokens)
    if (ir.ai_operations && Array.isArray(ir.ai_operations)) {
      for (const op of ir.ai_operations) {
        if (op.constraints) {
          // Convert temperature string to number
          if (typeof op.constraints.temperature === 'string') {
            const temp = parseFloat(op.constraints.temperature)
            op.constraints.temperature = isNaN(temp) ? undefined : temp
          }
          // Convert max_tokens string to number
          if (typeof op.constraints.max_tokens === 'string') {
            const tokens = parseInt(op.constraints.max_tokens, 10)
            op.constraints.max_tokens = isNaN(tokens) ? undefined : tokens
          }
        }
      }
    }

    // Fix data_sources config fields (max_results, etc.)
    if (ir.data_sources && Array.isArray(ir.data_sources)) {
      for (const ds of ir.data_sources) {
        if (ds.config) {
          // Convert max_results string to number
          if (typeof ds.config.max_results === 'string') {
            const maxResults = parseInt(ds.config.max_results, 10)
            ds.config.max_results = isNaN(maxResults) ? undefined : maxResults
          }
        }
      }
    }
  }

  /**
   * Calculate formalization confidence
   * Based on:
   * - Percentage of grounded facts used
   * - Number of critical assumptions validated
   * - Overall grounding confidence
   */
  private calculateFormalizationConfidence(
    groundedPlan: GroundedSemanticPlan,
    groundedFacts: Record<string, any>,
    missingFacts: string[]
  ): number {
    // Start with grounding confidence (handle case where it might be undefined)
    let confidence = groundedPlan.grounding_confidence ?? 0

    // Only apply penalties if we have assumptions with impact ratings
    if (groundedPlan.assumptions && Array.isArray(groundedPlan.assumptions)) {
      // Penalize for missing critical facts
      const criticalMissing = missingFacts.filter(id => {
        const assumption = groundedPlan.assumptions.find(a => a.id === id)
        return assumption?.impact_if_wrong === 'critical'
      })

      if (criticalMissing.length > 0) {
        confidence *= 0.5 // Cut confidence in half if critical facts missing
      }

      // Penalize for missing major facts
      const majorMissing = missingFacts.filter(id => {
        const assumption = groundedPlan.assumptions.find(a => a.id === id)
        return assumption?.impact_if_wrong === 'major'
      })

      if (majorMissing.length > 0) {
        confidence *= 0.8 // 20% penalty for major facts missing
      }
    }

    return confidence
  }

  /**
   * Validate that IR uses grounded facts correctly
   * (Post-formalization check)
   */
  validateFormalization(
    ir: DeclarativeLogicalIR,
    groundedFacts: Record<string, any>
  ): {
    valid: boolean
    errors: string[]
    warnings: string[]
  } {
    const errors: string[] = []
    const warnings: string[] = []

    // Check that filters use grounded field names
    if (ir.filters?.conditions) {
      for (const condition of ir.filters.conditions) {
        if (condition.field) {
          const isGrounded = Object.values(groundedFacts).includes(condition.field)
          if (!isGrounded) {
            warnings.push(`Filter field "${condition.field}" not found in grounded facts`)
          }
        }
      }
    }

    // Check that grouping uses grounded field names
    if (ir.grouping?.group_by) {
      const isGrounded = Object.values(groundedFacts).includes(ir.grouping.group_by)
      if (!isGrounded) {
        warnings.push(`Grouping field "${ir.grouping.group_by}" not found in grounded facts`)
      }
    }

    // Check that partitions use grounded field names
    if (ir.partitions) {
      for (const partition of ir.partitions) {
        if (partition.field) {
          const isGrounded = Object.values(groundedFacts).includes(partition.field)
          if (!isGrounded) {
            warnings.push(`Partition field "${partition.field}" not found in grounded facts`)
          }
        }
      }
    }

    // Validate rendering columns (check against grounded facts if provided)
    if (ir.rendering?.columns_in_order && Object.keys(groundedFacts).length > 0) {
      // Check if any grounded field facts exist in the rendering
      const groundedFieldFacts = Object.entries(groundedFacts).filter(([key]) => key.endsWith('_field'))

      if (groundedFieldFacts.length > 0) {
        for (const [fieldKey, fieldValue] of groundedFieldFacts) {
          if (fieldValue && typeof fieldValue === 'string' && !ir.rendering.columns_in_order.includes(fieldValue)) {
            // This is just a warning - column might be intentionally excluded
            // warnings.push(`Expected column "${fieldValue}" from grounded fact "${fieldKey}" not in rendering`)
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    }
  }
}

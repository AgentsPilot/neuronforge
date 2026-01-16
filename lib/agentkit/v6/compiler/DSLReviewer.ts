import OpenAI from 'openai'
import type { PluginManagerV2 } from '../../../server/plugin-manager-v2'

export interface DSLRepairConfig {
  apiKey?: string
  model?: string
  temperature?: number
  maxTokens?: number
  pluginManager?: PluginManagerV2
}

export interface DSLRepairResult {
  fixed_dsl: any[]
}

export class DSLRepairer {
  private openai: OpenAI
  private model: string
  private temperature: number
  private maxTokens: number
  private pluginManager?: PluginManagerV2

  constructor(config: DSLRepairConfig = {}) {
    this.openai = new OpenAI({
      apiKey: config.apiKey || process.env.OPENAI_API_KEY
    })

    this.model = config.model || 'gpt-5.2'
    this.temperature = config.temperature ?? 0
    this.maxTokens = config.maxTokens ?? 6000
    this.pluginManager = config.pluginManager
  }

  async repairDSL(
    enhancedPrompt: any,
    dslBeforeRepair: any[]
  ): Promise<DSLRepairResult> {
    const systemPrompt = this.buildSystemPrompt()
    const userPrompt = this.buildUserPrompt(enhancedPrompt, dslBeforeRepair)

    const response = await this.openai.chat.completions.create({
      model: this.model,
      temperature: this.temperature,
      max_completion_tokens: this.maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    })

    const content = response.choices[0]?.message?.content
    if (!content) {
      throw new Error('Empty repair response from LLM')
    }

    const parsed = JSON.parse(content)

    if (!Array.isArray(parsed.fixed_dsl)) {
      throw new Error('Repair output missing fixed_dsl array')
    }

    return { fixed_dsl: parsed.fixed_dsl }
  }

  private buildSystemPrompt(): string {
    return `
You are a DETERMINISTIC WORKFLOW DSL REPAIR ENGINE.

This is a STRUCTURAL REPAIR task - fix DSL step structure and parameters to match plugin schemas.

## Core Rules:
- Preserve intent exactly
- Preserve step_ids exactly
- No redesign, no new features
- Plugin-agnostic approach
- Output JSON only

## CRITICAL: Allowed Step Types and Operations

### Action Steps (type: "action")
Must have:
- plugin: string (exact plugin name from plugin definitions)
- action: string (exact action name from plugin actions)
- params: object (matching the action's parameter schema)

**CRITICAL: Nested Parameter Schemas**
Some plugins use nested object structures in params. You MUST match the exact nesting:
- google-mail send_email uses:
  - params.recipients.to (array)
  - params.recipients.cc (array, optional)
  - params.content.subject (string)
  - params.content.body (string)
  - params.options (object, optional)
- DO NOT flatten nested schemas into flat structure
- DO NOT use flat params like params.to or params.subject for google-mail send_email

### Transform Steps (type: "transform")
**ONLY use these operation types:**
- filter (with operators: ==, !=, contains, not_contains, >, <, >=, <=, in, not_in)
- map (field-to-field mapping)
- sort (with field and direction)
- group_by (with field)
- aggregate (with aggregation function)
- reduce
- deduplicate (with field)
- flatten (extract and flatten a nested field)
- render_table (for rendering data)

**FORBIDDEN operations:**
- set_from_column (doesn't exist)
- map_to_arrays (doesn't exist)
- text_contains_any (doesn't exist)
- not_in_set (doesn't exist)
- extract_field (doesn't exist - use flatten instead)

### Filter Predicates (in transform/filter steps)
**ONLY use standard JavaScript expressions or these operators:**
- == (equals)
- != (not equals)
- contains
- not_contains
- > (greater than)
- < (less than)
- >= (greater than or equal)
- <= (less than or equal)
- in (value in array)
- not_in (value not in array)

**DO NOT use custom predicate types** like text_contains_any, not_in_set

## Plugin Action Parameter Schemas

Plugin schemas are provided dynamically from the PluginManager.
**CRITICAL**: Use EXACT parameter names from the plugin schema - do NOT invent or modify parameter names.

## Deduplication Pattern (if needed)

Instead of custom operations, use standard approach:
1. Read existing data: action step with read_range
2. Map to extract IDs: transform step with map operation
3. Filter duplicates: transform step with filter operation using standard operators

## Expected Output Format

Return ONLY:
{
  "fixed_dsl": [
    {
      "id": "step_id",
      "name": "Step Name",
      "step_id": "step_id",
      "type": "action" | "transform",
      "plugin": "plugin-name",  // for action steps
      "action": "action_name",  // for action steps
      "operation": "filter|map|sort|...",  // for transform steps
      "params": { ... },  // for action steps
      "input": "{{variable}}",  // for transform steps
      "config": { ... }  // for transform steps
    }
  ]
}
`.trim()
  }

  private buildUserPrompt(enhancedPrompt: any, dsl: any[]): string {
    // Build plugin schemas section if PluginManager is available
    const pluginSchemasSection = this.buildPluginSchemasSection()

    return `
ENHANCED PROMPT:
${JSON.stringify(enhancedPrompt, null, 2)}

DSL BEFORE REPAIR:
${JSON.stringify(dsl, null, 2)}

${pluginSchemasSection}

TASK:
Repair the DSL so it is deterministic, executable, and exactly implements the Enhanced Prompt.
Use the EXACT parameter names from the plugin schemas above.
`.trim()
  }

  /**
   * Build plugin schemas section from PluginManager (NO HARDCODING!)
   */
  private buildPluginSchemasSection(): string {
    if (!this.pluginManager) {
      return ''
    }

    const availablePlugins = this.pluginManager.getAvailablePlugins()

    // Extract used plugins from DSL to only show relevant schemas
    const pluginSchemas = Object.entries(availablePlugins)
      .map(([pluginKey, pluginDef]) => {
        const actionsInfo = Object.entries(pluginDef.actions)
          .map(([actionName, actionDef]: [string, any]) => {
            const params = actionDef.parameters
            if (!params || !params.properties) {
              return `  - ${actionName}: No parameters`
            }

            const required = params.required || []
            const paramsList = Object.entries(params.properties)
              .map(([paramName, paramSchema]: [string, any]) => {
                const isReq = required.includes(paramName) ? ' (required)' : ''
                const type = paramSchema.type || 'any'
                const desc = paramSchema.description || ''
                return `      • ${paramName} (${type})${isReq}: ${desc}`
              })
              .join('\n')

            return `  - ${actionName}:\n${paramsList}`
          })
          .join('\n')

        return `### ${pluginKey}\n${actionsInfo}`
      })
      .join('\n\n')

    if (!pluginSchemas) {
      return ''
    }

    return `
## ACTUAL PLUGIN SCHEMAS (Use these EXACT parameter names)

${pluginSchemas}

**CRITICAL**: These are the ACTUAL plugin parameter names from the system.
Do NOT use different parameter names (e.g., do NOT use "sheet_name" if the plugin uses "range").
`
  }
}
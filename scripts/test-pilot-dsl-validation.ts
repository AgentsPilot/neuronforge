/**
 * PILOT DSL Validation Script
 *
 * Validates the compiled PILOT DSL against real plugin schemas to catch runtime failures.
 * This script checks:
 * 1. All plugin operations exist in schemas
 * 2. All required parameters match plugin schema requirements
 * 3. All parameter types match (object vs array, etc.)
 * 4. All output field references use correct field names from plugin schemas
 */

import { readFileSync } from 'fs'
import { join } from 'path'

interface PluginDefinition {
  plugin: { name: string }
  actions: Record<string, {
    description: string
    required_params?: string[]
    parameters: {
      required?: string[]
      properties: Record<string, { type: string; items?: any }>
    }
    output_schema?: {
      properties: Record<string, any>
    }
  }>
}

interface ValidationError {
  step_id: string
  severity: 'error' | 'warning'
  category: string
  message: string
  suggestion?: string
}

function loadPlugins(): Map<string, PluginDefinition> {
  const plugins = new Map<string, PluginDefinition>()
  const pluginFiles = [
    'google-mail-plugin-v2.json',
    'google-drive-plugin-v2.json',
    'google-sheets-plugin-v2.json',
    'document-extractor-plugin-v2.json',
  ]

  const pluginsDir = join(process.cwd(), 'lib', 'plugins', 'definitions')

  for (const fileName of pluginFiles) {
    const filePath = join(pluginsDir, fileName)
    const content = readFileSync(filePath, 'utf-8')
    const plugin = JSON.parse(content) as PluginDefinition
    const pluginKey = fileName.replace('-plugin-v2.json', '')
    plugins.set(pluginKey, plugin)
  }

  return plugins
}

async function validatePilotDSL() {
  console.log('Starting PILOT DSL validation...')

  // Load PILOT DSL
  const pilotSteps = JSON.parse(
    readFileSync('output/vocabulary-pipeline/pilot-dsl-steps.json', 'utf-8')
  )

  // Load plugins
  const plugins = loadPlugins()

  const errors: ValidationError[] = []

  // Track available variables as we process steps
  const availableVars = new Set<string>(['config'])

  // Track variable schemas for field access validation
  const variableSchemas = new Map<string, any>()

  for (const step of pilotSteps) {
    console.log(`Validating step ${step.step_id}: ${step.type}`)

    // Validate action steps against plugin schemas
    if (step.type === 'action') {
      const plugin = plugins.get(step.plugin)

      if (!plugin) {
        errors.push({
          step_id: step.step_id,
          severity: 'error',
          category: 'unknown_plugin',
          message: `Plugin "${step.plugin}" not found`,
        })
        continue
      }

      const action = plugin.actions[step.operation]

      if (!action) {
        errors.push({
          step_id: step.step_id,
          severity: 'error',
          category: 'unknown_operation',
          message: `Operation "${step.operation}" not found in plugin "${step.plugin}"`,
          suggestion: `Available operations: ${Object.keys(plugin.actions).join(', ')}`,
        })
        continue
      }

      // Validate required parameters
      const required = action.parameters.required || []
      const provided = Object.keys(step.config)

      const missing = required.filter((r: string) => !provided.includes(r))
      if (missing.length > 0) {
        errors.push({
          step_id: step.step_id,
          severity: 'error',
          category: 'missing_required_parameters',
          message: `Missing required parameters: ${missing.join(', ')}`,
          suggestion: `Required: ${required.join(', ')}, Provided: ${provided.join(', ')}`,
        })
      }

      // Validate parameter existence in schema
      for (const [key, value] of Object.entries(step.config)) {
        const schemaField = action.parameters.properties[key]
        if (!schemaField) {
          errors.push({
            step_id: step.step_id,
            severity: 'error',
            category: 'unknown_parameter',
            message: `Unknown parameter "${key}"`,
            suggestion: `Valid parameters: ${Object.keys(action.parameters.properties).join(', ')}`,
          })
        }

        // Validate parameter type (object vs array vs string)
        if (schemaField) {
          const expectedType = schemaField.type
          const providedValue = value

          // Check for type mismatches (fields object when values array expected, etc.)
          if (expectedType === 'array' && typeof providedValue === 'object' && !Array.isArray(providedValue)) {
            errors.push({
              step_id: step.step_id,
              severity: 'error',
              category: 'parameter_type_mismatch',
              message: `Parameter "${key}" expects array but got object`,
              suggestion: `Expected: array, Provided: object (convert to array format)`,
            })
          }
        }
      }

      // Validate template variable references in config
      const templateRefs = extractTemplateRefs(step.config)
      for (const ref of templateRefs) {
        const [varName, ...fieldPath] = ref.split('.')
        if (!availableVars.has(varName)) {
          errors.push({
            step_id: step.step_id,
            severity: 'error',
            category: 'undefined_variable',
            message: `References undefined variable: ${ref}`,
            suggestion: `Available variables: ${Array.from(availableVars).join(', ')}`,
          })
        }

        // Validate field access if variable has a known schema
        if (fieldPath.length > 0 && variableSchemas.has(varName)) {
          const schema = variableSchemas.get(varName)
          const field = fieldPath[0] // For now, just check first-level field access

          if (schema?.type === 'array' && schema?.items?.properties) {
            // Check array item schema
            if (!schema.items.properties[field]) {
              errors.push({
                step_id: step.step_id,
                severity: 'error',
                category: 'undefined_field',
                message: `Field "${field}" not found in variable "${varName}" schema`,
                suggestion: `Available fields: ${Object.keys(schema.items.properties).join(', ')}`,
              })
            }
          } else if (schema?.properties && !schema.properties[field]) {
            // Check object schema
            errors.push({
              step_id: step.step_id,
              severity: 'error',
              category: 'undefined_field',
              message: `Field "${field}" not found in variable "${varName}" schema`,
              suggestion: `Available fields: ${Object.keys(schema.properties).join(', ')}`,
            })
          }
        }
      }

      // Track action output schemas
      if (step.output_variable && action?.output_schema) {
        variableSchemas.set(step.output_variable, action.output_schema)
      }
    }

    // Track transform output schemas
    if (step.type === 'transform' && step.output_variable) {
      if (step.config?.output_schema) {
        // Explicit output schema provided
        variableSchemas.set(step.output_variable, step.config.output_schema)
      } else if (step.operation === 'filter' && step.input) {
        // Filter preserves input schema - extract input variable name
        const inputMatch = step.input.match(/\{\{([^}]+)\}\}/)
        const inputVar = inputMatch ? inputMatch[1] : null
        if (inputVar && variableSchemas.has(inputVar)) {
          // Copy input schema to output
          variableSchemas.set(step.output_variable, variableSchemas.get(inputVar))
        }
      }
    }

    // Add output variable to available set
    if (step.output_variable) {
      availableVars.add(step.output_variable)
    }

    // Handle scatter_gather loops (add item variable to inner scope)
    if (step.type === 'scatter_gather' && step.scatter) {
      const loopVars = new Set(availableVars)
      const loopSchemas = new Map(variableSchemas)

      // Extract input variable name from scatter.input (e.g., "{{candidate_attachments}}" -> "candidate_attachments")
      const inputVarMatch = step.scatter.input?.match(/\{\{([^}]+)\}\}/)
      const inputVar = inputVarMatch ? inputVarMatch[1] : null

      if (step.scatter.itemVariable) {
        loopVars.add(step.scatter.itemVariable)

        // If we know the input array schema, use its items schema for the loop variable
        if (inputVar && variableSchemas.has(inputVar)) {
          const inputSchema = variableSchemas.get(inputVar)
          if (inputSchema?.type === 'array' && inputSchema?.items) {
            loopSchemas.set(step.scatter.itemVariable, inputSchema.items)
          }
        }
      }

      // Validate inner steps with loop scope
      for (const innerStep of step.scatter.steps || []) {
        // Validate field access in loop body
        const innerRefs = extractTemplateRefs(innerStep.config || {})
        for (const ref of innerRefs) {
          const [varName, ...fieldPath] = ref.split('.')
          if (!loopVars.has(varName)) {
            errors.push({
              step_id: innerStep.step_id || innerStep.id,
              severity: 'error',
              category: 'undefined_variable',
              message: `References undefined variable: ${ref} (in loop body)`,
              suggestion: `Available in loop: ${Array.from(loopVars).join(', ')}`,
            })
          }

          // Validate field access for loop variables
          if (fieldPath.length > 0 && loopSchemas.has(varName)) {
            const schema = loopSchemas.get(varName)
            const field = fieldPath[0]

            if (schema?.properties && !schema.properties[field]) {
              errors.push({
                step_id: innerStep.step_id || innerStep.id,
                severity: 'error',
                category: 'undefined_field',
                message: `Field "${field}" not found in loop variable "${varName}" schema (in loop body)`,
                suggestion: `Available fields: ${Object.keys(schema.properties).join(', ')}`,
              })
            }
          }
        }

        // Add inner step's output variable to loop scope for subsequent steps
        if (innerStep.output_variable) {
          loopVars.add(innerStep.output_variable)
        }
      }
    }
  }

  // Report results
  if (errors.length > 0) {
    console.error('\n❌ PILOT DSL VALIDATION FAILED\n')
    console.error(`Found ${errors.length} error(s):\n`)

    for (const error of errors) {
      console.error(`[${error.severity.toUpperCase()}] Step ${error.step_id} (${error.category}):`)
      console.error(`  ${error.message}`)
      if (error.suggestion) {
        console.error(`  💡 ${error.suggestion}`)
      }
      console.error('')
    }

    process.exit(1)
  }

  console.log('\n✅ PILOT DSL VALIDATION PASSED')
  console.log(`Validated ${pilotSteps.length} steps successfully\n`)
}

/**
 * Extract all {{variable}} template references from an object
 */
function extractTemplateRefs(obj: any): string[] {
  const refs: string[] = []

  const extract = (val: any) => {
    if (typeof val === 'string') {
      const matches = val.matchAll(/\{\{([^}]+)\}\}/g)
      for (const match of matches) {
        refs.push(match[1])
      }
    } else if (Array.isArray(val)) {
      val.forEach(extract)
    } else if (typeof val === 'object' && val !== null) {
      Object.values(val).forEach(extract)
    }
  }

  extract(obj)
  return refs
}

// Run validation
validatePilotDSL().catch((error) => {
  console.error('Validation script error:', error)
  process.exit(1)
})

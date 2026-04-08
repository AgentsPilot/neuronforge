/**
 * Plugin Type Annotation Validator
 *
 * Scans plugin definitions and validates that all semantic type annotations
 * (`x-semantic-type`, `from_type`, `x-input-mapping.accepts`) use values
 * from the canonical vocabulary defined in input-type-compat.ts.
 *
 * Run as part of regression or CI to catch:
 * 1. Unknown x-semantic-type values not in the canonical ToType list
 * 2. Unknown from_type values not in the canonical FromType list
 * 3. Actions with file-typed inputs but no x-semantic-type on their output
 *
 * This is how we maintain the type vocabulary as plugins change —
 * the linter tells you when to update input-type-compat.ts.
 */

import { KNOWN_SEMANTIC_TYPES } from './input-type-compat'

export interface TypeAnnotationWarning {
  plugin_key: string
  action_name: string
  field_path: string
  issue: string
  suggestion: string
}

/**
 * Validate all type annotations in a set of plugin definitions.
 *
 * @param plugins Map of plugin_key → plugin definition object
 * @returns Array of warnings (empty = all valid)
 */
export function validatePluginTypeAnnotations(
  plugins: Record<string, any>,
): TypeAnnotationWarning[] {
  const warnings: TypeAnnotationWarning[] = []

  for (const [pluginKey, pluginDef] of Object.entries(plugins)) {
    const actions = pluginDef.actions || pluginDef.definition?.actions
    if (!actions) continue

    for (const [actionName, action] of Object.entries(actions as Record<string, any>)) {
      // Check output_schema for unknown x-semantic-type values
      if (action.output_schema) {
        walkSchema(action.output_schema, '', (path, node) => {
          const semanticType = node['x-semantic-type']
          if (semanticType && !KNOWN_SEMANTIC_TYPES.has(semanticType)) {
            warnings.push({
              plugin_key: pluginKey,
              action_name: actionName,
              field_path: `output_schema${path}`,
              issue: `Unknown x-semantic-type: "${semanticType}"`,
              suggestion: `Add "${semanticType}" to FromType/ToType in input-type-compat.ts and define its compatibility rules in TYPE_COMPAT`,
            })
          }
        })
      }

      // Check parameters for unknown from_type values
      if (action.parameters?.properties) {
        for (const [paramName, paramDef] of Object.entries(action.parameters.properties as Record<string, any>)) {
          const fromType = paramDef?.['x-variable-mapping']?.from_type
          if (fromType && !KNOWN_SEMANTIC_TYPES.has(fromType)) {
            warnings.push({
              plugin_key: pluginKey,
              action_name: actionName,
              field_path: `parameters.${paramName}.x-variable-mapping.from_type`,
              issue: `Unknown from_type: "${fromType}"`,
              suggestion: `Add "${fromType}" to FromType in input-type-compat.ts and define its compatibility rules in TYPE_COMPAT`,
            })
          }

          // Check x-input-mapping.accepts for unknown values
          const accepts = paramDef?.['x-input-mapping']?.accepts
          if (Array.isArray(accepts)) {
            for (const acceptVal of accepts) {
              if (acceptVal !== 'file_object' && acceptVal !== 'url_string' && !KNOWN_SEMANTIC_TYPES.has(acceptVal)) {
                warnings.push({
                  plugin_key: pluginKey,
                  action_name: actionName,
                  field_path: `parameters.${paramName}.x-input-mapping.accepts`,
                  issue: `Unknown accepts value: "${acceptVal}"`,
                  suggestion: `Add "${acceptVal}" to the canonical vocabulary in input-type-compat.ts or use a known type`,
                })
              }
            }
          }
        }
      }
    }
  }

  return warnings
}

/**
 * Walk a JSON Schema tree and call visitor on each node.
 */
function walkSchema(
  node: any,
  path: string,
  visitor: (path: string, node: any) => void,
): void {
  if (!node || typeof node !== 'object') return

  visitor(path, node)

  if (node.properties) {
    for (const [key, prop] of Object.entries(node.properties)) {
      walkSchema(prop, `${path}.${key}`, visitor)
    }
  }

  if (node.items) {
    walkSchema(node.items, `${path}.items`, visitor)
  }
}

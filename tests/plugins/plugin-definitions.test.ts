/**
 * Plugin Definition Validation Tests (Phase 0)
 *
 * Dynamically discovers all *-plugin-v2.json files in lib/plugins/definitions/
 * and validates:
 *   1. Required-vs-properties consistency (P0-01)
 *   2. Output schema validity via ajv (P0-02)
 *   3. x-variable-mapping reference resolution (P0-03)
 *
 * All tests are classified as [smoke] per P0-05.
 */

import * as fs from 'fs';
import * as path from 'path';
import Ajv from 'ajv';

// ---- Discovery ----

const DEFINITIONS_DIR = path.resolve(__dirname, '../../lib/plugins/definitions');

function discoverPluginDefinitions(): Array<{ fileName: string; filePath: string; definition: Record<string, unknown> }> {
  const files = fs.readdirSync(DEFINITIONS_DIR).filter(f => f.endsWith('-plugin-v2.json'));
  return files.map(fileName => {
    const filePath = path.join(DEFINITIONS_DIR, fileName);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const definition = JSON.parse(raw) as Record<string, unknown>;
    return { fileName, filePath, definition };
  });
}

const pluginDefinitions = discoverPluginDefinitions();

// ---- Helpers ----

interface ActionSchema {
  parameters?: {
    type?: string;
    required?: string[];
    properties?: Record<string, unknown>;
  };
  output_schema?: Record<string, unknown>;
}

/**
 * Recursively collect all x-variable-mapping references from a properties object.
 * Returns array of { propertyPath, mapping } where mapping has the x-variable-mapping value.
 */
function collectVariableMappings(
  properties: Record<string, Record<string, unknown>> | undefined,
  parentPath = ''
): Array<{ propertyPath: string; mapping: Record<string, unknown> }> {
  if (!properties) return [];
  const results: Array<{ propertyPath: string; mapping: Record<string, unknown> }> = [];

  for (const [key, value] of Object.entries(properties)) {
    const currentPath = parentPath ? `${parentPath}.${key}` : key;
    if (value && typeof value === 'object') {
      const mapping = (value as Record<string, unknown>)['x-variable-mapping'];
      if (mapping && typeof mapping === 'object') {
        results.push({ propertyPath: currentPath, mapping: mapping as Record<string, unknown> });
      }
      // Recurse into nested properties
      const nestedProps = (value as Record<string, unknown>).properties as Record<string, Record<string, unknown>> | undefined;
      if (nestedProps) {
        results.push(...collectVariableMappings(nestedProps, currentPath));
      }
    }
  }
  return results;
}

/**
 * Recursively check required-vs-properties consistency.
 * Returns array of { path, field } for each required field missing from properties.
 */
function findRequiredMismatches(
  schema: Record<string, unknown> | undefined,
  parentPath = ''
): Array<{ path: string; field: string }> {
  if (!schema) return [];
  const mismatches: Array<{ path: string; field: string }> = [];

  const required = schema.required as string[] | undefined;
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;

  if (required && required.length > 0) {
    if (!properties) {
      // All required fields are missing since there are no properties
      for (const field of required) {
        mismatches.push({ path: parentPath || 'root', field });
      }
    } else {
      for (const field of required) {
        if (!(field in properties)) {
          mismatches.push({ path: parentPath || 'root', field });
        }
      }
    }
  }

  // Recurse into nested properties that have their own required/properties
  if (properties) {
    for (const [key, value] of Object.entries(properties)) {
      if (value && typeof value === 'object' && ((value as Record<string, unknown>).required || (value as Record<string, unknown>).properties)) {
        const nestedPath = parentPath ? `${parentPath}.${key}` : key;
        mismatches.push(...findRequiredMismatches(value as Record<string, unknown>, nestedPath));
      }
      // Also check items schema for array types
      const items = (value as Record<string, unknown>)?.items as Record<string, unknown> | undefined;
      if (items && typeof items === 'object' && (items.required || items.properties)) {
        const itemsPath = parentPath ? `${parentPath}.${key}.items` : `${key}.items`;
        mismatches.push(...findRequiredMismatches(items, itemsPath));
      }
    }
  }

  return mismatches;
}

// ---- Tests ----

describe('Plugin Definition Validation', () => {
  // Sanity check: ensure we actually discovered plugins
  it('should discover at least 15 plugin definitions', () => {
    expect(pluginDefinitions.length).toBeGreaterThanOrEqual(15);
  });

  describe('[smoke]', () => {
    // Ajv 6 options: `strict` was introduced in Ajv 8 and is not valid here.
    // `allErrors` collects all validation errors instead of stopping at the first.
    const ajv = new Ajv({ allErrors: true });

    describe.each(pluginDefinitions.map(p => [p.fileName, p]))('%s', (_fileName, plugin) => {
      const { definition } = plugin as { fileName: string; filePath: string; definition: Record<string, unknown> };
      const actions = definition.actions as Record<string, ActionSchema> | undefined;

      it('required params exist in properties for all actions', () => {
        if (!actions) return;

        const allMismatches: Array<{ action: string; path: string; field: string }> = [];

        for (const [actionName, action] of Object.entries(actions)) {
          const mismatches = findRequiredMismatches(action.parameters as Record<string, unknown> | undefined, '');
          for (const m of mismatches) {
            allMismatches.push({ action: actionName, ...m });
          }
        }

        if (allMismatches.length > 0) {
          const details = allMismatches
            .map(m => `  action="${m.action}" path="${m.path}" field="${m.field}"`)
            .join('\n');
          throw new Error(`Required fields missing from properties:\n${details}`);
        }
      });

      it('output_schema blocks are valid JSON Schema', () => {
        if (!actions) return;

        const errors: string[] = [];

        for (const [actionName, action] of Object.entries(actions)) {
          if (!action.output_schema) continue;

          // Attempt to compile the output_schema as JSON Schema
          const valid = ajv.validateSchema(action.output_schema);
          if (!valid && ajv.errors) {
            // Ajv 6 uses `dataPath`; Ajv 8+ renamed it to `instancePath`. Support both
            // so this test remains compatible if Ajv is upgraded in the future.
            const errMessages = ajv.errors
              .map(e => {
                const errObj = e as unknown as { instancePath?: string; dataPath?: string; message?: string };
                const loc = errObj.instancePath || errObj.dataPath || '/';
                return `${loc}: ${errObj.message}`;
              })
              .join('; ');
            errors.push(`  action="${actionName}": ${errMessages}`);
          }
          // Also try to compile it to catch deeper issues
          try {
            ajv.compile(action.output_schema);
          } catch (compileErr: unknown) {
            const errMsg = compileErr instanceof Error ? compileErr.message : String(compileErr);
            errors.push(`  action="${actionName}" compile error: ${errMsg}`);
          }
        }

        if (errors.length > 0) {
          throw new Error(`Invalid output_schema blocks:\n${errors.join('\n')}`);
        }
      });

      it('x-variable-mapping references resolve', () => {
        if (!actions) return;

        const errors: string[] = [];

        // Collect all output_schema fields across all actions in this plugin.
        // x-variable-mapping.field_path is a cross-action reference: it tells the
        // compiler which field to extract from an *upstream* step's output, not from
        // the same action's input properties. So we validate against the union of
        // all output_schema fields in this plugin.
        const allOutputFields = new Set<string>();
        for (const action of Object.values(actions)) {
          const outputSchema = (action as Record<string, unknown>).output_schema as Record<string, unknown> | undefined;
          if (outputSchema?.properties) {
            for (const key of Object.keys(outputSchema.properties as Record<string, unknown>)) {
              allOutputFields.add(key);
            }
          }
          // Also collect from items.properties for array-type output schemas
          const items = (outputSchema as Record<string, unknown>)?.items as Record<string, unknown> | undefined;
          if (items?.properties) {
            for (const key of Object.keys(items.properties as Record<string, unknown>)) {
              allOutputFields.add(key);
            }
          }
        }

        for (const [actionName, action] of Object.entries(actions)) {
          const params = action.parameters;
          if (!params?.properties) continue;

          const topLevelProps = params.properties as Record<string, Record<string, unknown>>;
          const mappings = collectVariableMappings(topLevelProps);

          for (const { propertyPath, mapping } of mappings) {
            const fieldPath = mapping.field_path as string | undefined;
            if (!fieldPath) continue;

            const fromType = mapping.from_type as string | undefined;
            const rootField = fieldPath.split('.')[0];
            const topLevelKeys = Object.keys(topLevelProps);

            // Semantic from_types like 'file_attachment' reference system-level
            // object shapes (data, filename, content) that are conventions in the
            // compiler's typeToGenericParam map, not declared in any output_schema.
            // These cannot be statically validated against plugin schemas.
            const SYSTEM_FROM_TYPES = new Set(['file_attachment']);
            if (fromType && SYSTEM_FROM_TYPES.has(fromType)) continue;

            // field_path is valid if it matches any of:
            // 1. A top-level property in the same action's parameters (self-reference)
            // 2. The property name itself (self-annotation)
            // 3. A field in any output_schema across the plugin (cross-action reference)
            const isSameActionRef = topLevelKeys.includes(rootField);
            const isSelfRef = rootField === propertyPath.split('.')[0];
            const isOutputRef = allOutputFields.has(rootField);

            if (!isSameActionRef && !isSelfRef && !isOutputRef) {
              errors.push(
                `  action="${actionName}" property="${propertyPath}" x-variable-mapping.field_path="${fieldPath}" (from_type="${fromType}") references "${rootField}" which is not found in any action's input properties or output_schema`
              );
            }
          }
        }

        if (errors.length > 0) {
          throw new Error(`Dangling x-variable-mapping references:\n${errors.join('\n')}`);
        }
      });
    });
  });
});

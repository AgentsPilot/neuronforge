// lib/agentkit/v6/intent/plugin-spec-loader.ts
// Extract semantic operations from plugin OpenAPI specs

import type { PluginRegistry, PluginRegistryEntry, SemanticOp } from './plugin-vocabulary';

/**
 * OpenAPI spec structure (minimal for semantic op extraction)
 */
type OpenAPISpec = {
  paths?: {
    [path: string]: {
      [method: string]: {
        operationId?: string;
        'x-agentpilot-semantic-op'?: SemanticOp;
        responses?: {
          [statusCode: string]: {
            content?: {
              [mediaType: string]: {
                schema?: any;
              };
            };
          };
        };
      };
    };
  };
};

/**
 * Extract semantic operations from OpenAPI spec
 * Looks for x-agentpilot-semantic-op tags in operation definitions
 */
function extractSemanticOpsFromSpec(spec: OpenAPISpec): Array<{ op: SemanticOp; output_hints?: string[] }> {
  const semanticOps: Array<{ op: SemanticOp; output_hints?: string[] }> = [];

  if (!spec.paths) return semanticOps;

  for (const path of Object.values(spec.paths)) {
    for (const operation of Object.values(path)) {
      const semanticOp = operation['x-agentpilot-semantic-op'];
      if (semanticOp) {
        // Extract output hints from response schema if available
        const output_hints: string[] = [];
        const successResponse = operation.responses?.['200'] || operation.responses?.['201'];
        if (successResponse?.content?.['application/json']?.schema?.properties) {
          output_hints.push(...Object.keys(successResponse.content['application/json'].schema.properties));
        }

        semanticOps.push({
          op: semanticOp,
          output_hints: output_hints.length > 0 ? output_hints : undefined,
        });
      }
    }
  }

  return semanticOps;
}

/**
 * Load plugin registry from OpenAPI specs
 *
 * @param pluginKeys - Array of plugin keys to load (from services_involved)
 * @param specLoader - Function to load OpenAPI spec for a plugin key
 * @returns Plugin registry with semantic operations extracted from specs
 */
export async function loadPluginRegistryFromSpecs(args: {
  pluginKeys: string[];
  specLoader: (pluginKey: string) => Promise<OpenAPISpec | null>;
}): Promise<PluginRegistry> {
  const { pluginKeys, specLoader } = args;
  const registry: PluginRegistry = {};

  for (const pluginKey of pluginKeys) {
    const spec = await specLoader(pluginKey);
    if (!spec) {
      console.warn(`[PluginSpecLoader] No spec found for plugin: ${pluginKey}`);
      continue;
    }

    const semantic_ops = extractSemanticOpsFromSpec(spec);
    if (semantic_ops.length === 0) {
      console.warn(`[PluginSpecLoader] No semantic ops found in spec for plugin: ${pluginKey}`);
      continue;
    }

    registry[pluginKey] = {
      plugin_key: pluginKey,
      semantic_ops,
    };
  }

  return registry;
}

/**
 * Load OpenAPI spec from file system
 * In production, this would load from your plugin manager, database, or API
 */
export async function loadSpecFromFile(pluginKey: string): Promise<OpenAPISpec | null> {
  const fs = require('fs');
  const path = require('path');

  // Try common spec file locations
  const possiblePaths = [
    path.join(process.cwd(), 'lib/plugins/v2/configs', `${pluginKey}.json`),
    path.join(process.cwd(), 'lib/plugins/specs', `${pluginKey}.json`),
    path.join(process.cwd(), 'specs', `${pluginKey}.json`),
  ];

  for (const specPath of possiblePaths) {
    if (fs.existsSync(specPath)) {
      try {
        const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
        return spec;
      } catch (error) {
        console.error(`[PluginSpecLoader] Error loading spec from ${specPath}:`, error);
      }
    }
  }

  return null;
}

/**
 * Example: Load spec from URL/API
 */
export async function loadSpecFromURL(pluginKey: string): Promise<OpenAPISpec | null> {
  // In production: fetch from plugin registry API
  // const response = await fetch(`https://api.yourapp.com/plugins/${pluginKey}/spec`);
  // return await response.json();
  return null;
}

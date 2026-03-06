// lib/agentkit/v6/intent/plugin-semantic-catalog.ts
// Load plugin semantic operations from database table (golden source)

import type { PluginRegistry } from './plugin-vocabulary';
import { createClient } from '@supabase/supabase-js';

/**
 * Database row structure from plugin_semantic_ops table
 */
type PluginSemanticOpRow = {
  id: string;
  plugin_key: string;
  semantic_op: string;
  output_hints: string[] | null;
  param_hints: string[] | null;
  aliases: string[] | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Create Supabase client for database access
 * Uses service role key if available (bypasses RLS), otherwise anon key
 */
function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Try service role key first (for backend/CLI usage), fallback to anon key
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase credentials not found in environment variables');
  }

  return createClient(supabaseUrl, supabaseKey);
}

/**
 * Load plugin registry from database table
 * This is the GOLDEN SOURCE for plugin semantic operations
 *
 * @param pluginKeys - Array of plugin keys to load (from services_involved in Enhanced Prompt)
 * @returns Plugin registry with semantic operations from database
 */
export async function loadPluginRegistryFromDatabase(args: {
  pluginKeys: string[];
}): Promise<PluginRegistry> {
  const { pluginKeys } = args;

  if (pluginKeys.length === 0) {
    console.warn('[PluginSemanticCatalog] No plugin keys provided');
    return {};
  }

  // Normalize plugin keys to lowercase for matching
  const normalizedKeys = pluginKeys.map(k => k.toLowerCase());

  try {
    const supabase = getSupabaseClient();

    // Query database for semantic operations for the requested plugins
    // Match by plugin_key
    const { data: rows, error } = await supabase
      .from('plugin_semantic_ops')
      .select('*')
      .in('plugin_key', normalizedKeys);

    if (error) {
      console.error('[PluginSemanticCatalog] Database error:', error);
      throw new Error(`Failed to load plugin semantic ops from database: ${error.message}`);
    }

    if (!rows || rows.length === 0) {
      console.warn('[PluginSemanticCatalog] No semantic operations found for plugins:', pluginKeys);
      return {};
    }

    // Group rows by plugin_key
    const registry: PluginRegistry = {};

    for (const row of rows as PluginSemanticOpRow[]) {
      const pluginKey = row.plugin_key;

      if (!registry[pluginKey]) {
        registry[pluginKey] = {
          plugin_key: pluginKey,
          semantic_ops: [],
          aliases: row.aliases || undefined,
        };
      }

      registry[pluginKey].semantic_ops.push({
        op: row.semantic_op as any, // Database stores string, cast to semantic op type
        output_hints: row.output_hints || undefined,
        param_hints: (row.param_hints || undefined) as any, // Database stores string[], cast to ParamHint[]
      });
    }

    console.log(
      `[PluginSemanticCatalog] Loaded ${Object.keys(registry).length} plugins with ${rows.length} semantic operations`
    );

    return registry;
  } catch (error) {
    console.error('[PluginSemanticCatalog] Unexpected error loading from database:', error);
    throw error;
  }
}

/**
 * Convenience function: Load all available plugins from database
 * Use this for admin/debugging purposes only
 */
export async function loadAllPluginsFromDatabase(): Promise<PluginRegistry> {
  try {
    const supabase = await createClient();

    const { data: rows, error } = await supabase
      .from('plugin_semantic_ops')
      .select('*')
      .order('plugin_key', { ascending: true })
      .order('semantic_op', { ascending: true });

    if (error) {
      console.error('[PluginSemanticCatalog] Database error:', error);
      throw new Error(`Failed to load all plugin semantic ops: ${error.message}`);
    }

    if (!rows || rows.length === 0) {
      console.warn('[PluginSemanticCatalog] No semantic operations found in database');
      return {};
    }

    // Group rows by plugin_key
    const registry: PluginRegistry = {};

    for (const row of rows as PluginSemanticOpRow[]) {
      const pluginKey = row.plugin_key;

      if (!registry[pluginKey]) {
        registry[pluginKey] = {
          plugin_key: pluginKey,
          semantic_ops: [],
          aliases: row.aliases || undefined,
        };
      }

      registry[pluginKey].semantic_ops.push({
        op: row.semantic_op as any, // Database stores string, cast to semantic op type
        output_hints: row.output_hints || undefined,
        param_hints: (row.param_hints || undefined) as any, // Database stores string[], cast to ParamHint[]
      });
    }

    console.log(
      `[PluginSemanticCatalog] Loaded all plugins: ${Object.keys(registry).length} plugins with ${rows.length} semantic operations`
    );

    return registry;
  } catch (error) {
    console.error('[PluginSemanticCatalog] Unexpected error loading all plugins:', error);
    throw error;
  }
}

/**
 * Get list of all available plugin keys in the database
 */
export async function getAvailablePluginKeys(): Promise<string[]> {
  try {
    const supabase = getSupabaseClient();

    const { data: rows, error } = await supabase
      .from('plugin_semantic_ops')
      .select('plugin_key')
      .order('plugin_key', { ascending: true });

    if (error) {
      console.error('[PluginSemanticCatalog] Database error:', error);
      throw new Error(`Failed to get plugin keys: ${error.message}`);
    }

    if (!rows || rows.length === 0) {
      return [];
    }

    // Return unique plugin keys
    const uniqueKeys = Array.from(new Set((rows as Array<{ plugin_key: string }>).map(r => r.plugin_key)));
    return uniqueKeys;
  } catch (error) {
    console.error('[PluginSemanticCatalog] Unexpected error getting plugin keys:', error);
    throw error;
  }
}

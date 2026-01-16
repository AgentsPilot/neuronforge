/**
 * API Endpoint: Fetch Plugin Data for Semantic Plan
 *
 * POST /api/v6/fetch-plugin-data
 *
 * Fetches real data from a connected plugin and returns metadata for semantic plan grounding.
 * Uses existing V2 plugin manager infrastructure - works with ANY connected plugin.
 *
 * Request:
 * {
 *   userId: string
 *   pluginName: string (e.g., "google-sheets", "airtable", "hubspot")
 *   actionName: string (e.g., "read_range", "list_records")
 *   parameters: { ... } (plugin-specific parameters)
 * }
 *
 * Response:
 * {
 *   success: true,
 *   data_source_metadata: {
 *     type: "tabular",
 *     headers: [...],
 *     sample_rows: [...],
 *     plugin_key: "google-sheets",
 *     row_count: number
 *   },
 *   raw_plugin_response: { ... }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { PluginExecuterV2 } from '@/lib/server/plugin-executer-v2';

export async function POST(request: NextRequest) {
  console.log('[API] /api/v6/fetch-plugin-data - POST');

  try {
    const body = await request.json();
    const { userId, pluginName, actionName, parameters } = body;

    // Validate required fields
    if (!userId || !pluginName || !actionName) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields',
          details: 'userId, pluginName, and actionName are required'
        },
        { status: 400 }
      );
    }

    console.log(`[API] Fetching data from plugin: ${pluginName}.${actionName}`);
    console.log(`[API] User: ${userId}`);
    console.log(`[API] Parameters:`, parameters);

    // Execute plugin action using existing V2 plugin infrastructure
    const pluginExecuter = await PluginExecuterV2.getInstance();
    const result = await pluginExecuter.execute(userId, pluginName, actionName, parameters || {});

    console.log(`[API] Plugin execution result:`, {
      success: result.success,
      hasData: !!result.data
    });

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Plugin execution failed',
          details: result.error || result.message,
          plugin_result: result
        },
        { status: 400 }
      );
    }

    // Transform plugin response to DataSourceMetadata format
    const metadata = transformPluginDataToMetadata(result.data, pluginName);

    console.log('[API] ✓ Data fetched and transformed to metadata');
    console.log(`[API] Headers: ${metadata.headers?.length || 0}`);
    console.log(`[API] Sample rows: ${metadata.sample_rows?.length || 0}`);

    return NextResponse.json({
      success: true,
      data_source_metadata: metadata,
      raw_plugin_response: result.data,
      metadata: {
        plugin: pluginName,
        action: actionName,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('[API] Error fetching plugin data:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch plugin data',
        details: errorMessage,
        stack: process.env.NODE_ENV === 'development' ? errorStack : undefined
      },
      { status: 500 }
    );
  }
}

/**
 * Transform plugin-specific data to standardized DataSourceMetadata format
 * Supports: Google Sheets, Airtable, HubSpot, and other tabular data sources
 */
function transformPluginDataToMetadata(pluginData: any, pluginName: string): any {
  console.log(`[API] Transforming ${pluginName} data to metadata format`);

  // Google Sheets format: { values: [[row1], [row2], ...], row_count, column_count }
  if (pluginName === 'google-sheets' && pluginData.values) {
    const rows = pluginData.values;
    if (rows.length === 0) {
      return {
        type: 'tabular',
        headers: [],
        sample_rows: [],
        plugin_key: pluginName,
        row_count: 0
      };
    }

    // First row is headers
    const headers = rows[0];

    // Convert remaining rows to objects
    const sampleRows = rows.slice(1, Math.min(6, rows.length)).map((row: any[]) => {
      const obj: Record<string, any> = {};
      headers.forEach((header: string, index: number) => {
        obj[header] = row[index] !== undefined ? row[index] : null;
      });
      return obj;
    });

    return {
      type: 'tabular',
      headers,
      sample_rows: sampleRows,
      plugin_key: pluginName,
      row_count: rows.length - 1, // Exclude header row
      original_format: 'google_sheets'
    };
  }

  // Airtable format: { records: [{ id, fields: {...} }, ...] }
  if (pluginName === 'airtable' && pluginData.records) {
    const records = pluginData.records;
    if (records.length === 0) {
      return {
        type: 'tabular',
        headers: [],
        sample_rows: [],
        plugin_key: pluginName,
        row_count: 0
      };
    }

    // Extract headers from first record's fields
    const headers = Object.keys(records[0].fields || {});

    // Convert to sample rows (max 5)
    const sampleRows = records.slice(0, 5).map((record: any) => record.fields);

    return {
      type: 'tabular',
      headers,
      sample_rows: sampleRows,
      plugin_key: pluginName,
      row_count: records.length,
      original_format: 'airtable'
    };
  }

  // HubSpot format: { results: [{ properties: {...} }, ...] }
  if (pluginName === 'hubspot' && pluginData.results) {
    const results = pluginData.results;
    if (results.length === 0) {
      return {
        type: 'tabular',
        headers: [],
        sample_rows: [],
        plugin_key: pluginName,
        row_count: 0
      };
    }

    // Extract headers from first result's properties
    const headers = Object.keys(results[0].properties || results[0]);

    // Convert to sample rows (max 5)
    const sampleRows = results.slice(0, 5).map((result: any) =>
      result.properties || result
    );

    return {
      type: 'tabular',
      headers,
      sample_rows: sampleRows,
      plugin_key: pluginName,
      row_count: results.length,
      original_format: 'hubspot'
    };
  }

  // Generic array of objects format
  if (Array.isArray(pluginData)) {
    if (pluginData.length === 0) {
      return {
        type: 'tabular',
        headers: [],
        sample_rows: [],
        plugin_key: pluginName,
        row_count: 0
      };
    }

    const headers = Object.keys(pluginData[0]);
    const sampleRows = pluginData.slice(0, 5);

    return {
      type: 'tabular',
      headers,
      sample_rows: sampleRows,
      plugin_key: pluginName,
      row_count: pluginData.length,
      original_format: 'array'
    };
  }

  // Fallback: return raw data with type indicator
  console.warn(`[API] Unknown plugin data format for ${pluginName}, returning raw`);
  return {
    type: 'unknown',
    raw_data: pluginData,
    plugin_key: pluginName,
    headers: [],
    sample_rows: []
  };
}

// CORS headers (if needed)
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}

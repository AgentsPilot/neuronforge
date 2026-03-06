#!/usr/bin/env node
/**
 * Script to add V6 capability binding metadata to all remaining Google plugins
 */

const fs = require('fs');
const path = require('path');

// Plugin metadata configurations
const pluginsConfig = {
  'google-sheets-plugin-v2.json': {
    provider_family: 'google',
    actions: {
      create_spreadsheet: {
        domain: 'table',
        capability: 'create',
        input_entity: null,
        output_entity: 'row',
        input_cardinality: null,
        output_cardinality: 'single',
        output_fields: ['spreadsheet_id', 'spreadsheet_url', 'title', 'created_at'],
        required_params: ['title'],
        optional_params: ['sheet_names'],
        must_support: ['multi_sheet', 'url_access']
      },

      get_or_create_spreadsheet: {
        domain: 'table',
        capability: 'upsert',
        input_entity: null,
        output_entity: 'row',
        input_cardinality: null,
        output_cardinality: 'single',
        output_fields: ['spreadsheet_id', 'spreadsheet_url', 'title', 'existed'],
        required_params: ['title'],
        optional_params: ['sheet_names', 'folder_id'],
        must_support: ['idempotent_creation', 'multi_sheet']
      },

      get_spreadsheet_info: {
        domain: 'table',
        capability: 'get',
        input_entity: 'row',
        output_entity: 'row',
        input_cardinality: 'single',
        output_cardinality: 'single',
        output_fields: ['spreadsheet_id', 'title', 'sheets', 'url', 'owner'],
        required_params: ['spreadsheet_id'],
        optional_params: [],
        must_support: ['metadata_fetch', 'sheet_list']
      },

      read_range: {
        domain: 'table',
        capability: 'get',
        input_entity: 'row',
        output_entity: 'row',
        input_cardinality: 'collection',
        output_cardinality: 'collection',
        output_fields: ['range', 'values', 'row_count', 'column_count'],
        required_params: ['spreadsheet_id', 'range'],
        optional_params: ['value_render_option'],
        must_support: ['range_selection', 'formatted_values']
      },

      write_range: {
        domain: 'table',
        capability: 'update',
        input_entity: 'row',
        output_entity: 'row',
        input_cardinality: 'collection',
        output_cardinality: 'collection',
        output_fields: ['updated_range', 'updated_rows', 'updated_columns', 'updated_cells'],
        required_params: ['spreadsheet_id', 'range', 'values'],
        optional_params: ['value_input_option'],
        must_support: ['range_overwrite', 'batch_write']
      },

      append_rows: {
        domain: 'table',
        capability: 'append',
        input_entity: 'row',
        output_entity: 'row',
        input_cardinality: 'collection',
        output_cardinality: 'collection',
        output_fields: ['updated_range', 'appended_rows', 'spreadsheet_id', 'sheet_name'],
        required_params: ['spreadsheet_id', 'range', 'values'],
        optional_params: ['value_input_option'],
        must_support: ['auto_append', 'batch_append']
      }
    }
  },

  'google-docs-plugin-v2.json': {
    provider_family: 'google',
    actions: {
      create_document: {
        domain: 'document',
        capability: 'create',
        input_entity: null,
        output_entity: 'document',
        input_cardinality: null,
        output_cardinality: 'single',
        output_fields: ['document_id', 'title', 'document_url', 'created_at'],
        required_params: ['title'],
        optional_params: ['content', 'folder_id'],
        must_support: ['rich_text', 'url_access']
      },

      get_or_create_document: {
        domain: 'document',
        capability: 'upsert',
        input_entity: null,
        output_entity: 'document',
        input_cardinality: null,
        output_cardinality: 'single',
        output_fields: ['document_id', 'title', 'document_url', 'existed'],
        required_params: ['title'],
        optional_params: ['folder_id', 'content'],
        must_support: ['idempotent_creation', 'rich_text']
      },

      read_document: {
        domain: 'document',
        capability: 'fetch_content',
        input_entity: 'document',
        output_entity: 'document',
        input_cardinality: 'single',
        output_cardinality: 'single',
        output_fields: ['document_id', 'title', 'content', 'plain_text', 'url'],
        required_params: ['document_id'],
        optional_params: ['format'],
        must_support: ['plain_text_export', 'rich_text_export']
      },

      append_content: {
        domain: 'document',
        capability: 'append',
        input_entity: 'document',
        output_entity: 'document',
        input_cardinality: 'single',
        output_cardinality: 'single',
        output_fields: ['document_id', 'title', 'updated_at', 'document_url'],
        required_params: ['document_id', 'content'],
        optional_params: ['location'],
        must_support: ['append_text', 'rich_text']
      },

      replace_content: {
        domain: 'document',
        capability: 'update',
        input_entity: 'document',
        output_entity: 'document',
        input_cardinality: 'single',
        output_cardinality: 'single',
        output_fields: ['document_id', 'title', 'updated_at', 'document_url'],
        required_params: ['document_id', 'find_text', 'replace_text'],
        optional_params: ['match_case'],
        must_support: ['find_replace', 'regex_support']
      }
    }
  },

  'google-calendar-plugin-v2.json': {
    provider_family: 'google',
    actions: {
      list_events: {
        domain: 'calendar',
        capability: 'list',
        input_entity: null,
        output_entity: 'event',
        input_cardinality: null,
        output_cardinality: 'collection',
        output_fields: ['id', 'summary', 'start', 'end', 'location', 'attendees', 'description'],
        required_params: [],
        optional_params: ['calendar_id', 'time_min', 'time_max', 'max_results'],
        must_support: ['date_range_filter', 'timezone_aware']
      },

      create_event: {
        domain: 'calendar',
        capability: 'create',
        input_entity: null,
        output_entity: 'event',
        input_cardinality: null,
        output_cardinality: 'single',
        output_fields: ['id', 'summary', 'start', 'end', 'htmlLink', 'created'],
        required_params: ['summary', 'start_time', 'end_time'],
        optional_params: ['description', 'location', 'attendees', 'calendar_id'],
        must_support: ['attendee_management', 'recurring_events', 'timezone_aware']
      },

      update_event: {
        domain: 'calendar',
        capability: 'update',
        input_entity: 'event',
        output_entity: 'event',
        input_cardinality: 'single',
        output_cardinality: 'single',
        output_fields: ['id', 'summary', 'start', 'end', 'updated'],
        required_params: ['event_id'],
        optional_params: ['summary', 'start_time', 'end_time', 'description', 'location', 'attendees'],
        must_support: ['partial_update', 'attendee_management']
      },

      delete_event: {
        domain: 'calendar',
        capability: 'delete',
        input_entity: 'event',
        output_entity: null,
        input_cardinality: 'single',
        output_cardinality: null,
        output_fields: ['deleted', 'event_id'],
        required_params: ['event_id'],
        optional_params: ['send_updates'],
        must_support: ['notification_control']
      },

      search_events: {
        domain: 'calendar',
        capability: 'search',
        input_entity: null,
        output_entity: 'event',
        input_cardinality: null,
        output_cardinality: 'collection',
        output_fields: ['id', 'summary', 'start', 'end', 'location', 'attendees'],
        required_params: ['query'],
        optional_params: ['calendar_id', 'time_min', 'time_max', 'max_results'],
        must_support: ['full_text_search', 'date_range_filter']
      }
    }
  }
};

// Process each plugin
for (const [filename, config] of Object.entries(pluginsConfig)) {
  const pluginPath = path.join(__dirname, '../lib/plugins/definitions', filename);

  if (!fs.existsSync(pluginPath)) {
    console.log(`⚠️  Plugin not found: ${filename}`);
    continue;
  }

  console.log(`\n📦 Processing ${filename}...`);

  const plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf-8'));

  // Add provider_family to plugin level
  plugin.plugin.provider_family = config.provider_family;
  console.log(`  ✅ Added provider_family: ${config.provider_family}`);

  // Apply metadata to each action
  let enhancedCount = 0;
  for (const [actionName, metadata] of Object.entries(config.actions)) {
    if (plugin.actions[actionName]) {
      const action = plugin.actions[actionName];
      const newAction = {
        description: action.description,
        usage_context: action.usage_context,
        idempotent: action.idempotent,
        ...metadata,  // Insert V6 metadata here
        parameters: action.parameters,
        rules: action.rules,
        output_schema: action.output_schema,
        output_guidance: action.output_guidance
      };

      // Preserve optional fields
      if (action.idempotent_alternative) {
        newAction.idempotent_alternative = action.idempotent_alternative;
      }

      plugin.actions[actionName] = newAction;
      enhancedCount++;
      console.log(`  ✅ Enhanced ${actionName}`);
    } else {
      console.log(`  ⚠️  Action ${actionName} not found in plugin`);
    }
  }

  // Write back to file
  fs.writeFileSync(pluginPath, JSON.stringify(plugin, null, 2));
  console.log(`  📄 ${enhancedCount}/${Object.keys(config.actions).length} actions enhanced`);
}

console.log('\n✅ All Google plugins enhanced successfully\n');

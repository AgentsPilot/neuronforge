#!/usr/bin/env node
/**
 * Script to add V6 capability binding metadata to Google Drive plugin
 */

const fs = require('fs');
const path = require('path');

const pluginPath = path.join(__dirname, '../lib/plugins/definitions/google-drive-plugin-v2.json');
const plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf-8'));

// Define V6 metadata for each action
const actionMetadata = {
  list_files: {
    domain: 'storage',
    capability: 'list',
    input_entity: 'folder',
    output_entity: 'file',
    input_cardinality: 'single',
    output_cardinality: 'collection',
    output_fields: ['id', 'name', 'mimeType', 'size', 'createdTime', 'modifiedTime', 'parents', 'webViewLink'],
    required_params: [],
    optional_params: ['folder_id', 'max_results', 'mime_type', 'query'],
    must_support: ['folder_browsing', 'mime_type_filter', 'date_filter']
  },

  search_files: {
    domain: 'storage',
    capability: 'search',
    input_entity: null,
    output_entity: 'file',
    input_cardinality: null,
    output_cardinality: 'collection',
    output_fields: ['id', 'name', 'mimeType', 'size', 'createdTime', 'modifiedTime', 'parents', 'webViewLink', 'description'],
    required_params: [],
    optional_params: ['query', 'max_results', 'mime_type', 'folder_id'],
    must_support: ['full_text_search', 'mime_type_filter', 'folder_scoped_search']
  },

  get_file_metadata: {
    domain: 'storage',
    capability: 'get',
    input_entity: 'file',
    output_entity: 'file',
    input_cardinality: 'single',
    output_cardinality: 'single',
    output_fields: ['id', 'name', 'mimeType', 'size', 'createdTime', 'modifiedTime', 'parents', 'webViewLink', 'owners', 'permissions'],
    required_params: ['file_id'],
    optional_params: ['include_permissions'],
    must_support: ['metadata_fetch', 'permission_info']
  },

  read_file_content: {
    domain: 'storage',
    capability: 'fetch_content',
    input_entity: 'file',
    output_entity: 'file',
    input_cardinality: 'single',
    output_cardinality: 'single',
    output_fields: ['id', 'name', 'mimeType', 'content', 'text_content', 'size'],
    required_params: ['file_id'],
    optional_params: ['export_mime_type'],
    must_support: ['text_extraction', 'google_docs_export', 'binary_download']
  },

  upload_file: {
    domain: 'storage',
    capability: 'upload',
    input_entity: 'file',
    output_entity: 'file',
    input_cardinality: 'single',
    output_cardinality: 'single',
    output_fields: ['id', 'name', 'mimeType', 'size', 'webViewLink', 'createdTime'],
    required_params: ['file_data'],
    optional_params: ['file_name', 'parent_folder_id', 'mime_type'],
    must_support: ['folder_upload', 'overwrite_prevention']
  },

  create_folder: {
    domain: 'storage',
    capability: 'create',
    input_entity: 'folder',
    output_entity: 'folder',
    input_cardinality: 'single',
    output_cardinality: 'single',
    output_fields: ['id', 'name', 'mimeType', 'webViewLink', 'createdTime'],
    required_params: ['folder_name'],
    optional_params: ['parent_folder_id'],
    must_support: ['nested_folders']
  },

  get_or_create_folder: {
    domain: 'storage',
    capability: 'upsert',
    input_entity: 'folder',
    output_entity: 'folder',
    input_cardinality: 'single',
    output_cardinality: 'single',
    output_fields: ['id', 'name', 'mimeType', 'webViewLink', 'existed', 'createdTime'],
    required_params: ['folder_name'],
    optional_params: ['parent_folder_id'],
    must_support: ['idempotent_folder_creation', 'nested_folders']
  },

  get_folder_contents: {
    domain: 'storage',
    capability: 'list',
    input_entity: 'folder',
    output_entity: 'file',
    input_cardinality: 'single',
    output_cardinality: 'collection',
    output_fields: ['id', 'name', 'mimeType', 'size', 'createdTime', 'modifiedTime', 'webViewLink'],
    required_params: ['folder_id'],
    optional_params: ['max_results', 'include_subfolders'],
    must_support: ['recursive_listing', 'folder_browsing']
  },

  share_file: {
    domain: 'storage',
    capability: 'update',
    input_entity: 'file',
    output_entity: 'file',
    input_cardinality: 'single',
    output_cardinality: 'single',
    output_fields: ['id', 'name', 'webViewLink', 'permissions', 'shared_link'],
    required_params: ['file_id'],
    optional_params: ['email', 'role', 'type', 'send_notification'],
    must_support: ['permission_management', 'link_sharing', 'email_sharing']
  }
};

// Apply metadata to each action
for (const [actionName, metadata] of Object.entries(actionMetadata)) {
  if (plugin.actions[actionName]) {
    // Insert metadata after idempotent field, before parameters
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

    // Add idempotent_alternative if it exists
    if (action.idempotent_alternative) {
      newAction.idempotent_alternative = action.idempotent_alternative;
    }

    plugin.actions[actionName] = newAction;
    console.log(`✅ Enhanced ${actionName}`);
  } else {
    console.log(`⚠️  Action ${actionName} not found in plugin`);
  }
}

// Write back to file
fs.writeFileSync(pluginPath, JSON.stringify(plugin, null, 2));
console.log('\n✅ Google Drive plugin enhanced successfully');
console.log(`📄 Updated: ${pluginPath}`);

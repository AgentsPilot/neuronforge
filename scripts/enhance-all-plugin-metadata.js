#!/usr/bin/env node
/**
 * Enhance All Plugin Metadata
 *
 * Adds extension fields to all plugin definitions:
 * - x-guaranteed: Output fields that are always present
 * - x-variable-mapping: How to extract values from input objects
 * - x-input-mapping: Multiple input type support
 * - x-context-binding: Workflow config binding for required params
 */

const fs = require('fs');
const path = require('path');

const PLUGIN_DIR = path.join(__dirname, '../lib/plugins/definitions');

// Read all plugin definition files
const pluginFiles = fs.readdirSync(PLUGIN_DIR).filter(f => f.endsWith('.json'));

console.log(`Found ${pluginFiles.length} plugin files to enhance\n`);

let totalActions = 0;
let enhancedActions = 0;

for (const file of pluginFiles) {
  const filePath = path.join(PLUGIN_DIR, file);
  const plugin = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  console.log(`Enhancing ${plugin.plugin.name}...`);

  let modified = false;

  for (const [actionName, action] of Object.entries(plugin.actions)) {
    totalActions++;
    let actionModified = false;

    // Enhancement 1: Add x-guaranteed to output schema properties
    if (action.output_schema && action.output_schema.properties) {
      if (!action.output_schema.required) {
        // Infer required fields from output_fields if available
        if (action.output_fields && action.output_fields.length > 0) {
          action.output_schema.required = action.output_fields.slice(0, 3); // Top 3 most important
          actionModified = true;
        }
      }

      // Mark guaranteed fields
      for (const [fieldName, fieldDef] of Object.entries(action.output_schema.properties)) {
        // Core identifier fields are always guaranteed
        if (fieldName.includes('id') || fieldName.includes('_id') ||
            fieldName === 'name' || fieldName === 'title' ||
            fieldName.includes('_at') && fieldName.includes('ed')) {
          if (!fieldDef['x-guaranteed']) {
            fieldDef['x-guaranteed'] = true;
            actionModified = true;
          }
        }
      }
    }

    // Enhancement 2: Add x-variable-mapping for common parameter patterns
    if (action.parameters && action.parameters.properties) {
      for (const [paramName, paramDef] of Object.entries(action.parameters.properties)) {
        // File content parameters
        if ((paramName === 'file_content' || paramName === 'content') && !paramDef['x-variable-mapping']) {
          paramDef['x-variable-mapping'] = {
            from_type: 'file_attachment',
            field_path: 'content',
            description: 'Extract content from attachment or file object'
          };
          actionModified = true;
        }

        // Filename parameters
        if ((paramName === 'file_name' || paramName === 'filename') && !paramDef['x-variable-mapping']) {
          paramDef['x-variable-mapping'] = {
            from_type: 'file_attachment',
            field_path: 'filename',
            description: 'Extract filename from attachment or file object'
          };
          actionModified = true;
        }

        // Folder ID parameters
        if (paramName === 'folder_id' && !paramDef['x-variable-mapping']) {
          paramDef['x-variable-mapping'] = {
            from_type: 'folder',
            field_path: 'folder_id',
            description: 'Extract folder ID from folder object'
          };
          actionModified = true;
        }

        // Spreadsheet ID parameters (context binding)
        if (paramName === 'spreadsheet_id' && !paramDef['x-context-binding']) {
          paramDef['x-context-binding'] = {
            source: 'workflow_config',
            key: 'spreadsheet_id',
            required: false,
            description: 'Spreadsheet ID from workflow configuration'
          };
          actionModified = true;
        }
      }
    }

    // Enhancement 3: Add x-input-mapping for file URL parameters
    if (action.parameters && action.parameters.properties) {
      for (const [paramName, paramDef] of Object.entries(action.parameters.properties)) {
        if ((paramName === 'file_url' || paramName === 'url') && paramDef.type === 'string' && !paramDef['x-input-mapping']) {
          paramDef['x-input-mapping'] = {
            accepts: ['file_object', 'url_string'],
            from_file_object: 'web_view_link',
            description: 'Can accept file object (extracts web_view_link) or direct URL string'
          };
          actionModified = true;
        }
      }
    }

    if (actionModified) {
      enhancedActions++;
      modified = true;
      console.log(`  ✓ Enhanced ${actionName}`);
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, JSON.stringify(plugin, null, 2) + '\n', 'utf8');
    console.log(`  Saved ${file}\n`);
  } else {
    console.log(`  No enhancements needed\n`);
  }
}

console.log(`\n═══════════════════════════════════════`);
console.log(`Enhancement Summary`);
console.log(`═══════════════════════════════════════`);
console.log(`Total actions: ${totalActions}`);
console.log(`Enhanced actions: ${enhancedActions}`);
console.log(`Enhancement rate: ${((enhancedActions / totalActions) * 100).toFixed(1)}%`);

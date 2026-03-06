#!/usr/bin/env node
/**
 * Fix remaining Google Docs and Calendar actions with V6 metadata
 */

const fs = require('fs');
const path = require('path');

// Google Docs actions
const docsConfig = {
  'append_text': {
    domain: 'document',
    capability: 'append',
    input_entity: 'document',
    output_entity: 'document',
    input_cardinality: 'single',
    output_cardinality: 'single',
    output_fields: ['document_id', 'title', 'updated_at', 'document_url'],
    required_params: ['document_id', 'text'],
    optional_params: ['location'],
    must_support: ['append_text', 'rich_text']
  },

  'get_document_info': {
    domain: 'document',
    capability: 'get',
    input_entity: 'document',
    output_entity: 'document',
    input_cardinality: 'single',
    output_cardinality: 'single',
    output_fields: ['document_id', 'title', 'document_url', 'created_time', 'modified_time'],
    required_params: ['document_id'],
    optional_params: [],
    must_support: ['metadata_fetch']
  },

  'insert_text': {
    domain: 'document',
    capability: 'update',
    input_entity: 'document',
    output_entity: 'document',
    input_cardinality: 'single',
    output_cardinality: 'single',
    output_fields: ['document_id', 'title', 'updated_at', 'document_url'],
    required_params: ['document_id', 'text', 'index'],
    optional_params: [],
    must_support: ['insert_at_position', 'rich_text']
  }
};

// Google Calendar actions
const calendarConfig = {
  'get_event_details': {
    domain: 'calendar',
    capability: 'get',
    input_entity: 'event',
    output_entity: 'event',
    input_cardinality: 'single',
    output_cardinality: 'single',
    output_fields: ['id', 'summary', 'description', 'start', 'end', 'location', 'attendees', 'htmlLink'],
    required_params: ['event_id'],
    optional_params: ['calendar_id'],
    must_support: ['full_details']
  }
};

// Process Google Docs
const docsPath = path.join(__dirname, '../lib/plugins/definitions/google-docs-plugin-v2.json');
const docsPlugin = JSON.parse(fs.readFileSync(docsPath, 'utf-8'));

console.log('\n📦 Fixing Google Docs plugin...');
for (const [actionName, metadata] of Object.entries(docsConfig)) {
  if (docsPlugin.actions[actionName]) {
    const action = docsPlugin.actions[actionName];
    const newAction = {
      description: action.description,
      usage_context: action.usage_context,
      idempotent: action.idempotent,
      ...metadata,
      parameters: action.parameters,
      rules: action.rules,
      output_schema: action.output_schema,
      output_guidance: action.output_guidance
    };

    if (action.idempotent_alternative) {
      newAction.idempotent_alternative = action.idempotent_alternative;
    }

    docsPlugin.actions[actionName] = newAction;
    console.log(`  ✅ Enhanced ${actionName}`);
  }
}

fs.writeFileSync(docsPath, JSON.stringify(docsPlugin, null, 2));
console.log('  📄 Google Docs complete');

// Process Google Calendar
const calendarPath = path.join(__dirname, '../lib/plugins/definitions/google-calendar-plugin-v2.json');
const calendarPlugin = JSON.parse(fs.readFileSync(calendarPath, 'utf-8'));

console.log('\n📦 Fixing Google Calendar plugin...');
for (const [actionName, metadata] of Object.entries(calendarConfig)) {
  if (calendarPlugin.actions[actionName]) {
    const action = calendarPlugin.actions[actionName];
    const newAction = {
      description: action.description,
      usage_context: action.usage_context,
      idempotent: action.idempotent,
      ...metadata,
      parameters: action.parameters,
      rules: action.rules,
      output_schema: action.output_schema,
      output_guidance: action.output_guidance
    };

    if (action.idempotent_alternative) {
      newAction.idempotent_alternative = action.idempotent_alternative;
    }

    calendarPlugin.actions[actionName] = newAction;
    console.log(`  ✅ Enhanced ${actionName}`);
  }
}

fs.writeFileSync(calendarPath, JSON.stringify(calendarPlugin, null, 2));
console.log('  📄 Google Calendar complete\n');

console.log('✅ All Google plugins now fully enhanced\n');

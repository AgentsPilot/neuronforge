#!/usr/bin/env node
/**
 * Final enhancement for remaining plugin actions
 */

const fs = require('fs');
const path = require('path');

const fixes = {
  'whatsapp-plugin-v2.json': {
    send_text_message: {
      domain: 'messaging',
      capability: 'send_message',
      input_entity: null,
      output_entity: 'message',
      input_cardinality: null,
      output_cardinality: 'single',
      output_fields: ['message_id', 'status'],
      required_params: ['to', 'body'],
      optional_params: [],
      must_support: ['phone_numbers']
    },
    send_interactive_message: {
      domain: 'messaging',
      capability: 'send_message',
      input_entity: null,
      output_entity: 'message',
      input_cardinality: null,
      output_cardinality: 'single',
      output_fields: ['message_id', 'status'],
      required_params: ['to', 'interactive'],
      optional_params: [],
      must_support: ['interactive_buttons']
    },
    list_message_templates: {
      domain: 'messaging',
      capability: 'list',
      input_entity: null,
      output_entity: 'message',
      input_cardinality: null,
      output_cardinality: 'collection',
      output_fields: ['name', 'language', 'status', 'category'],
      required_params: [],
      optional_params: [],
      must_support: ['templates']
    },
    mark_message_read: {
      domain: 'messaging',
      capability: 'update',
      input_entity: 'message',
      output_entity: 'message',
      input_cardinality: 'single',
      output_cardinality: 'single',
      output_fields: ['success'],
      required_params: ['message_id'],
      optional_params: [],
      must_support: ['read_receipts']
    }
  },

  'hubspot-plugin-v2.json': {
    get_contact: {
      domain: 'crm',
      capability: 'get',
      input_entity: 'contact',
      output_entity: 'contact',
      input_cardinality: 'single',
      output_cardinality: 'single',
      output_fields: ['id', 'email', 'firstname', 'lastname', 'phone', 'company'],
      required_params: ['contact_id'],
      optional_params: [],
      must_support: ['custom_properties']
    },
    create_contact_note: {
      domain: 'crm',
      capability: 'create',
      input_entity: 'contact',
      output_entity: 'transaction',
      input_cardinality: 'single',
      output_cardinality: 'single',
      output_fields: ['id', 'created_at', 'note'],
      required_params: ['contact_id', 'note'],
      optional_params: [],
      must_support: ['activity_tracking']
    },
    create_task: {
      domain: 'crm',
      capability: 'create',
      input_entity: null,
      output_entity: 'transaction',
      input_cardinality: null,
      output_cardinality: 'single',
      output_fields: ['id', 'subject', 'due_date'],
      required_params: ['subject'],
      optional_params: ['due_date', 'contact_id'],
      must_support: ['task_management']
    },
    get_contact_activities: {
      domain: 'crm',
      capability: 'list',
      input_entity: 'contact',
      output_entity: 'transaction',
      input_cardinality: 'single',
      output_cardinality: 'collection',
      output_fields: ['id', 'type', 'timestamp', 'details'],
      required_params: ['contact_id'],
      optional_params: [],
      must_support: ['activity_history']
    },
    get_contact_deals: {
      domain: 'crm',
      capability: 'list',
      input_entity: 'contact',
      output_entity: 'transaction',
      input_cardinality: 'single',
      output_cardinality: 'collection',
      output_fields: ['id', 'dealname', 'amount', 'dealstage'],
      required_params: ['contact_id'],
      optional_params: [],
      must_support: ['deal_association']
    },
    get_deal: {
      domain: 'crm',
      capability: 'get',
      input_entity: 'transaction',
      output_entity: 'transaction',
      input_cardinality: 'single',
      output_cardinality: 'single',
      output_fields: ['id', 'dealname', 'amount', 'pipeline', 'dealstage'],
      required_params: ['deal_id'],
      optional_params: [],
      must_support: ['deal_details']
    }
  },

  'airtable-plugin-v2.json': {
    create_records: {
      domain: 'database',
      capability: 'create',
      input_entity: null,
      output_entity: 'record',
      input_cardinality: null,
      output_cardinality: 'collection',
      output_fields: ['id', 'fields', 'createdTime'],
      required_params: ['base_id', 'table_name', 'records'],
      optional_params: [],
      must_support: ['batch_create', 'flexible_schema']
    },
    update_records: {
      domain: 'database',
      capability: 'update',
      input_entity: 'record',
      output_entity: 'record',
      input_cardinality: 'collection',
      output_cardinality: 'collection',
      output_fields: ['id', 'fields', 'createdTime'],
      required_params: ['base_id', 'table_name', 'records'],
      optional_params: [],
      must_support: ['batch_update', 'partial_update']
    },
    get_record: {
      domain: 'database',
      capability: 'get',
      input_entity: 'record',
      output_entity: 'record',
      input_cardinality: 'single',
      output_cardinality: 'single',
      output_fields: ['id', 'fields', 'createdTime'],
      required_params: ['base_id', 'table_name', 'record_id'],
      optional_params: [],
      must_support: []
    },
    list_bases: {
      domain: 'database',
      capability: 'list',
      input_entity: null,
      output_entity: 'record',
      input_cardinality: null,
      output_cardinality: 'collection',
      output_fields: ['id', 'name', 'permissionLevel'],
      required_params: [],
      optional_params: [],
      must_support: ['base_discovery']
    },
    list_tables: {
      domain: 'database',
      capability: 'list',
      input_entity: null,
      output_entity: 'record',
      input_cardinality: null,
      output_cardinality: 'collection',
      output_fields: ['id', 'name', 'fields'],
      required_params: ['base_id'],
      optional_params: [],
      must_support: ['schema_discovery']
    },
    upload_attachment: {
      domain: 'database',
      capability: 'upload',
      input_entity: 'file',
      output_entity: 'file',
      input_cardinality: 'single',
      output_cardinality: 'single',
      output_fields: ['id', 'url', 'filename'],
      required_params: ['base_id', 'table_name', 'record_id', 'field_name', 'file'],
      optional_params: [],
      must_support: ['file_attachments']
    },
    get_attachment_urls: {
      domain: 'database',
      capability: 'get',
      input_entity: 'file',
      output_entity: 'file',
      input_cardinality: 'collection',
      output_cardinality: 'collection',
      output_fields: ['url', 'filename', 'size'],
      required_params: ['base_id', 'table_name', 'record_id', 'field_name'],
      optional_params: [],
      must_support: ['attachment_access']
    }
  },

  'chatgpt-research-plugin-v2.json': {
    research_topic: {
      domain: 'web',
      capability: 'search',
      input_entity: null,
      output_entity: 'document',
      input_cardinality: null,
      output_cardinality: 'single',
      output_fields: ['research', 'sources', 'summary'],
      required_params: ['topic'],
      optional_params: ['depth'],
      must_support: ['web_search', 'source_attribution']
    },
    answer_question: {
      domain: 'internal',
      capability: 'generate',
      input_entity: null,
      output_entity: 'document',
      input_cardinality: null,
      output_cardinality: 'single',
      output_fields: ['answer', 'confidence'],
      required_params: ['question'],
      optional_params: ['context'],
      must_support: ['question_answering']
    },
    summarize_content: {
      domain: 'internal',
      capability: 'summarize',
      input_entity: 'document',
      output_entity: 'document',
      input_cardinality: 'single',
      output_cardinality: 'single',
      output_fields: ['summary', 'key_points'],
      required_params: ['content'],
      optional_params: ['max_length'],
      must_support: ['text_summarization']
    }
  }
};

let totalFixed = 0;

for (const [filename, actions] of Object.entries(fixes)) {
  const pluginPath = path.join(__dirname, '../lib/plugins/definitions', filename);
  const plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf-8'));

  console.log(`\n📦 Fixing ${filename}...`);

  for (const [actionName, metadata] of Object.entries(actions)) {
    if (plugin.actions[actionName]) {
      const action = plugin.actions[actionName];
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

      plugin.actions[actionName] = newAction;
      totalFixed++;
      console.log(`  ✅ Enhanced ${actionName}`);
    }
  }

  fs.writeFileSync(pluginPath, JSON.stringify(plugin, null, 2));
}

console.log(`\n✅ Fixed ${totalFixed} additional actions\n`);

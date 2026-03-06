#!/usr/bin/env node
/**
 * Comprehensive script to add V6 metadata to all remaining plugins
 */

const fs = require('fs');
const path = require('path');

const pluginsConfig = {
  'slack-plugin-v2.json': {
    provider_family: 'slack',
    actions: {
      send_message: {
        domain: 'messaging',
        capability: 'send_message',
        input_entity: null,
        output_entity: 'message',
        input_cardinality: null,
        output_cardinality: 'single',
        output_fields: ['ts', 'channel', 'message', 'thread_ts'],
        required_params: ['channel', 'text'],
        optional_params: ['thread_ts', 'blocks', 'attachments'],
        must_support: ['threads', 'rich_formatting', 'mentions']
      },
      read_messages: {
        domain: 'messaging',
        capability: 'search',
        input_entity: null,
        output_entity: 'message',
        input_cardinality: null,
        output_cardinality: 'collection',
        output_fields: ['ts', 'user', 'text', 'channel', 'thread_ts'],
        required_params: ['channel'],
        optional_params: ['limit', 'oldest', 'latest'],
        must_support: ['history_fetch', 'thread_messages']
      },
      create_channel: {
        domain: 'messaging',
        capability: 'create',
        input_entity: null,
        output_entity: 'message',
        input_cardinality: null,
        output_cardinality: 'single',
        output_fields: ['id', 'name', 'created'],
        required_params: ['name'],
        optional_params: ['is_private'],
        must_support: ['public_channels', 'private_channels']
      },
      get_or_create_channel: {
        domain: 'messaging',
        capability: 'upsert',
        input_entity: null,
        output_entity: 'message',
        input_cardinality: null,
        output_cardinality: 'single',
        output_fields: ['id', 'name', 'existed'],
        required_params: ['name'],
        optional_params: ['is_private'],
        must_support: ['idempotent_creation']
      },
      list_channels: {
        domain: 'messaging',
        capability: 'list',
        input_entity: null,
        output_entity: 'message',
        input_cardinality: null,
        output_cardinality: 'collection',
        output_fields: ['id', 'name', 'is_private', 'num_members'],
        required_params: [],
        optional_params: ['exclude_archived', 'types'],
        must_support: ['all_channel_types']
      },
      update_message: {
        domain: 'messaging',
        capability: 'update',
        input_entity: 'message',
        output_entity: 'message',
        input_cardinality: 'single',
        output_cardinality: 'single',
        output_fields: ['ts', 'channel', 'text'],
        required_params: ['channel', 'ts', 'text'],
        optional_params: [],
        must_support: ['message_editing']
      },
      add_reaction: {
        domain: 'messaging',
        capability: 'update',
        input_entity: 'message',
        output_entity: 'message',
        input_cardinality: 'single',
        output_cardinality: 'single',
        output_fields: ['ok'],
        required_params: ['channel', 'timestamp', 'name'],
        optional_params: [],
        must_support: ['reactions']
      },
      remove_reaction: {
        domain: 'messaging',
        capability: 'update',
        input_entity: 'message',
        output_entity: 'message',
        input_cardinality: 'single',
        output_cardinality: 'single',
        output_fields: ['ok'],
        required_params: ['channel', 'timestamp', 'name'],
        optional_params: [],
        must_support: ['reactions']
      },
      upload_file: {
        domain: 'messaging',
        capability: 'upload',
        input_entity: 'file',
        output_entity: 'file',
        input_cardinality: 'single',
        output_cardinality: 'single',
        output_fields: ['id', 'name', 'url_private'],
        required_params: ['file'],
        optional_params: ['channels', 'title', 'initial_comment'],
        must_support: ['file_sharing']
      },
      list_users: {
        domain: 'messaging',
        capability: 'list',
        input_entity: null,
        output_entity: 'contact',
        input_cardinality: null,
        output_cardinality: 'collection',
        output_fields: ['id', 'name', 'real_name', 'email'],
        required_params: [],
        optional_params: [],
        must_support: ['user_list']
      },
      get_user_info: {
        domain: 'messaging',
        capability: 'get',
        input_entity: 'contact',
        output_entity: 'contact',
        input_cardinality: 'single',
        output_cardinality: 'single',
        output_fields: ['id', 'name', 'real_name', 'email', 'title'],
        required_params: ['user_id'],
        optional_params: [],
        must_support: ['user_profile']
      }
    }
  },

  'whatsapp-plugin-v2.json': {
    provider_family: 'meta',
    actions: {
      send_message: {
        domain: 'messaging',
        capability: 'send_message',
        input_entity: null,
        output_entity: 'message',
        input_cardinality: null,
        output_cardinality: 'single',
        output_fields: ['message_id', 'status', 'sent_at'],
        required_params: ['to', 'message'],
        optional_params: ['message_type'],
        must_support: ['phone_numbers']
      },
      send_template_message: {
        domain: 'messaging',
        capability: 'send_message',
        input_entity: null,
        output_entity: 'message',
        input_cardinality: null,
        output_cardinality: 'single',
        output_fields: ['message_id', 'status'],
        required_params: ['to', 'template_name'],
        optional_params: ['parameters'],
        must_support: ['templates', 'parameters']
      }
    }
  },

  'linkedin-plugin-v2.json': {
    provider_family: 'linkedin',
    actions: {
      create_post: {
        domain: 'messaging',
        capability: 'post_message',
        input_entity: null,
        output_entity: 'message',
        input_cardinality: null,
        output_cardinality: 'single',
        output_fields: ['id', 'created_at', 'url'],
        required_params: ['text'],
        optional_params: ['visibility'],
        must_support: ['visibility_control']
      },
      get_profile: {
        domain: 'crm',
        capability: 'get',
        input_entity: null,
        output_entity: 'contact',
        input_cardinality: null,
        output_cardinality: 'single',
        output_fields: ['id', 'firstName', 'lastName', 'headline', 'profilePicture'],
        required_params: [],
        optional_params: [],
        must_support: ['profile_data']
      }
    }
  },

  'hubspot-plugin-v2.json': {
    provider_family: 'hubspot',
    actions: {
      create_contact: {
        domain: 'crm',
        capability: 'create',
        input_entity: null,
        output_entity: 'contact',
        input_cardinality: null,
        output_cardinality: 'single',
        output_fields: ['id', 'email', 'firstname', 'lastname', 'created_at'],
        required_params: ['email'],
        optional_params: ['firstname', 'lastname', 'phone', 'company'],
        must_support: ['custom_properties']
      },
      search_contacts: {
        domain: 'crm',
        capability: 'search',
        input_entity: null,
        output_entity: 'contact',
        input_cardinality: null,
        output_cardinality: 'collection',
        output_fields: ['id', 'email', 'firstname', 'lastname'],
        required_params: [],
        optional_params: ['query', 'limit'],
        must_support: ['full_text_search']
      },
      update_contact: {
        domain: 'crm',
        capability: 'update',
        input_entity: 'contact',
        output_entity: 'contact',
        input_cardinality: 'single',
        output_cardinality: 'single',
        output_fields: ['id', 'updated_at'],
        required_params: ['contact_id'],
        optional_params: ['email', 'firstname', 'lastname', 'phone', 'company'],
        must_support: ['custom_properties', 'partial_update']
      },
      create_company: {
        domain: 'crm',
        capability: 'create',
        input_entity: null,
        output_entity: 'contact',
        input_cardinality: null,
        output_cardinality: 'single',
        output_fields: ['id', 'name', 'domain', 'created_at'],
        required_params: ['name'],
        optional_params: ['domain', 'industry'],
        must_support: ['company_records']
      },
      create_deal: {
        domain: 'crm',
        capability: 'create',
        input_entity: null,
        output_entity: 'transaction',
        input_cardinality: null,
        output_cardinality: 'single',
        output_fields: ['id', 'dealname', 'amount', 'pipeline', 'dealstage'],
        required_params: ['dealname'],
        optional_params: ['amount', 'pipeline', 'dealstage'],
        must_support: ['deal_management', 'pipeline_stages']
      }
    }
  },

  'airtable-plugin-v2.json': {
    provider_family: 'airtable',
    actions: {
      list_records: {
        domain: 'database',
        capability: 'list',
        input_entity: null,
        output_entity: 'record',
        input_cardinality: null,
        output_cardinality: 'collection',
        output_fields: ['id', 'fields', 'createdTime'],
        required_params: ['base_id', 'table_name'],
        optional_params: ['max_records', 'view', 'formula'],
        must_support: ['formula_filter', 'view_filter']
      },
      create_record: {
        domain: 'database',
        capability: 'create',
        input_entity: null,
        output_entity: 'record',
        input_cardinality: null,
        output_cardinality: 'single',
        output_fields: ['id', 'fields', 'createdTime'],
        required_params: ['base_id', 'table_name', 'fields'],
        optional_params: [],
        must_support: ['flexible_schema']
      },
      update_record: {
        domain: 'database',
        capability: 'update',
        input_entity: 'record',
        output_entity: 'record',
        input_cardinality: 'single',
        output_cardinality: 'single',
        output_fields: ['id', 'fields', 'createdTime'],
        required_params: ['base_id', 'table_name', 'record_id', 'fields'],
        optional_params: [],
        must_support: ['partial_update']
      },
      delete_record: {
        domain: 'database',
        capability: 'delete',
        input_entity: 'record',
        output_entity: null,
        input_cardinality: 'single',
        output_cardinality: null,
        output_fields: ['deleted', 'id'],
        required_params: ['base_id', 'table_name', 'record_id'],
        optional_params: [],
        must_support: []
      },
      search_records: {
        domain: 'database',
        capability: 'search',
        input_entity: null,
        output_entity: 'record',
        input_cardinality: null,
        output_cardinality: 'collection',
        output_fields: ['id', 'fields', 'createdTime'],
        required_params: ['base_id', 'table_name', 'formula'],
        optional_params: ['max_records'],
        must_support: ['formula_search']
      }
    }
  },

  'chatgpt-research-plugin-v2.json': {
    provider_family: 'openai',
    actions: {
      research_query: {
        domain: 'web',
        capability: 'search',
        input_entity: null,
        output_entity: 'document',
        input_cardinality: null,
        output_cardinality: 'single',
        output_fields: ['answer', 'sources', 'confidence'],
        required_params: ['query'],
        optional_params: ['max_sources'],
        must_support: ['web_search', 'source_attribution']
      }
    }
  }
};

// Process each plugin
let totalPlugins = 0;
let totalActions = 0;

for (const [filename, config] of Object.entries(pluginsConfig)) {
  const pluginPath = path.join(__dirname, '../lib/plugins/definitions', filename);

  if (!fs.existsSync(pluginPath)) {
    console.log(`⚠️  Plugin not found: ${filename}`);
    continue;
  }

  console.log(`\n📦 Processing ${filename}...`);
  totalPlugins++;

  const plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf-8'));

  // Add provider_family
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
      enhancedCount++;
      totalActions++;
      console.log(`  ✅ Enhanced ${actionName}`);
    } else {
      console.log(`  ⚠️  Action ${actionName} not found`);
    }
  }

  // Write back
  fs.writeFileSync(pluginPath, JSON.stringify(plugin, null, 2));
  console.log(`  📄 ${enhancedCount} actions enhanced`);
}

console.log(`\n✅ Enhanced ${totalPlugins} plugins, ${totalActions} total actions\n`);

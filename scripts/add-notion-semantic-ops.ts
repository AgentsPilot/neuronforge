#!/usr/bin/env npx tsx
// Script to add Notion plugin semantic operations to database

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import path from 'path';

config({ path: path.join(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const notionSemanticOps = [
  {
    plugin_key: 'notion',
    semantic_op: 'KNOWLEDGE.SEARCH',
    output_hints: ['results', 'has_more', 'next_cursor', 'result_count'],
    param_hints: ['query', 'filter', 'sort', 'page_size'],
    aliases: ['notion-search'],
    notes: 'Search for pages and databases across Notion workspace'
  },
  {
    plugin_key: 'notion',
    semantic_op: 'PAGE.GET',
    output_hints: ['id', 'created_time', 'last_edited_time', 'properties', 'url', 'parent'],
    param_hints: ['page_id'],
    aliases: ['notion-get-page'],
    notes: 'Get a page\'s properties and metadata'
  },
  {
    plugin_key: 'notion',
    semantic_op: 'PAGE.GET_CONTENT',
    output_hints: ['blocks', 'text_content', 'has_more', 'block_count'],
    param_hints: ['page_id', 'page_size'],
    aliases: ['notion-read-page', 'notion-get-content'],
    notes: 'Get the block content of a page'
  },
  {
    plugin_key: 'notion',
    semantic_op: 'PAGE.CREATE',
    output_hints: ['id', 'url', 'created_time', 'properties'],
    param_hints: ['parent', 'properties', 'children'],
    aliases: ['notion-create-page'],
    notes: 'Create a new page in Notion'
  },
  {
    plugin_key: 'notion',
    semantic_op: 'PAGE.UPDATE',
    output_hints: ['id', 'last_edited_time', 'properties'],
    param_hints: ['page_id', 'properties'],
    aliases: ['notion-update-page'],
    notes: 'Update a page\'s properties'
  },
  {
    plugin_key: 'notion',
    semantic_op: 'DATABASE.QUERY',
    output_hints: ['results', 'has_more', 'next_cursor', 'result_count'],
    param_hints: ['database_id', 'filter', 'sorts', 'page_size'],
    aliases: ['notion-query-database', 'notion-list-pages'],
    notes: 'Query a database with filtering, sorting, and pagination'
  },
  {
    plugin_key: 'notion',
    semantic_op: 'DATABASE.GET',
    output_hints: ['id', 'title', 'properties', 'created_time', 'url'],
    param_hints: ['database_id'],
    aliases: ['notion-get-database'],
    notes: 'Get database schema and properties'
  },
  {
    plugin_key: 'notion',
    semantic_op: 'CONTENT.APPEND',
    output_hints: ['results', 'block_count'],
    param_hints: ['block_id', 'children'],
    aliases: ['notion-append-blocks', 'notion-add-content'],
    notes: 'Append content blocks to a page or block'
  }
];

async function addSemanticOps() {
  console.log('Adding Notion plugin semantic operations...\n');

  // First check if any Notion ops already exist
  const { data: existing } = await supabase
    .from('plugin_semantic_ops')
    .select('*')
    .eq('plugin_key', 'notion');

  if (existing && existing.length > 0) {
    console.log(`⚠️  Found ${existing.length} existing Notion semantic ops. Deleting them first...`);
    const { error: deleteError } = await supabase
      .from('plugin_semantic_ops')
      .delete()
      .eq('plugin_key', 'notion');

    if (deleteError) {
      console.error('❌ Error deleting existing ops:', deleteError);
      return;
    }
    console.log('✅ Deleted existing ops\n');
  }

  // Insert new semantic ops
  console.log(`📝 Inserting ${notionSemanticOps.length} Notion semantic operations...`);
  
  const { data, error } = await supabase
    .from('plugin_semantic_ops')
    .insert(notionSemanticOps)
    .select();

  if (error) {
    console.error('❌ Error inserting:', error);
    return;
  }

  console.log(`✅ Successfully added ${data?.length || 0} Notion semantic operations\n`);
  
  // Verify
  const { data: verified, count } = await supabase
    .from('plugin_semantic_ops')
    .select('*', { count: 'exact' })
    .eq('plugin_key', 'notion');

  console.log(`📊 Verification: ${count} Notion semantic ops in database`);
  
  if (verified && verified.length > 0) {
    console.log('\n📦 Sample inserted row:');
    console.log(JSON.stringify(verified[0], null, 2));
  }
}

addSemanticOps().catch(console.error);

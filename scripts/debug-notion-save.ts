#!/usr/bin/env npx tsx
// Debug why Notion connection isn't saving

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import path from 'path';

config({ path: path.join(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function debugNotionSave() {
  console.log('Testing if we can save Notion connection to database...\n');

  // Get your user ID from existing connections
  const { data: existingConn } = await supabase
    .from('plugin_connections')
    .select('user_id')
    .limit(1)
    .single();

  if (!existingConn) {
    console.log('❌ No existing connections found to get user_id');
    return;
  }

  const userId = existingConn.user_id;
  console.log('Using user_id:', userId);

  // Try to insert a test Notion connection
  const testConnection = {
    user_id: userId,
    plugin_key: 'notion',
    plugin_name: 'Notion',
    access_token: 'test_token_123',
    refresh_token: null,
    expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    scope: null,
    username: 'Test User',
    email: 'test@example.com',
    profile_data: { test: true },
    settings: {},
    status: 'active'
  };

  console.log('\nInserting test Notion connection...');
  const { data, error } = await supabase
    .from('plugin_connections')
    .insert(testConnection)
    .select()
    .single();

  if (error) {
    console.error('❌ Error inserting:', error);
    return;
  }

  console.log('✅ Test connection inserted successfully!');
  console.log('Connection ID:', data.id);

  // Now delete the test connection
  console.log('\nCleaning up test connection...');
  const { error: deleteError } = await supabase
    .from('plugin_connections')
    .delete()
    .eq('id', data.id);

  if (deleteError) {
    console.error('❌ Error deleting test connection:', deleteError);
  } else {
    console.log('✅ Test connection cleaned up');
  }

  console.log('\n✅ Database supports Notion connections!');
  console.log('\nThe issue must be in the OAuth callback handler.');
  console.log('Please check the browser DevTools Network tab for the OAuth callback request.');
}

debugNotionSave().catch(console.error);

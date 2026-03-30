#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { savePluginConnection } from '../lib/plugins/savePluginConnection';
import path from 'path';

config({ path: path.join(__dirname, '../.env.local') });

async function testSave() {
  console.log('Testing manual Notion connection save...\n');

  // Get user ID from existing connection
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: existing } = await supabase
    .from('plugin_connections')
    .select('user_id')
    .limit(1)
    .single();

  if (!existing) {
    console.log('❌ No user found');
    return;
  }

  const testData = {
    user_id: existing.user_id,
    plugin_key: 'notion',
    plugin_name: 'Notion',
    access_token: 'test_token_' + Date.now(),
    refresh_token: null,
    expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    scope: null,
    username: 'Test Notion User',
    email: 'test@notion.com',
    profile_data: { bot_id: 'test_bot_123' },
    settings: {},
    status: 'active'
  };

  console.log('Calling savePluginConnection...');
  try {
    const saved = await savePluginConnection(testData);
    console.log('✅ Save successful!');
    console.log('Saved connection ID:', saved.id);
    console.log('Plugin key:', saved.plugin_key);
    
    // Clean up
    console.log('\nCleaning up test connection...');
    await supabase
      .from('plugin_connections')
      .delete()
      .eq('id', saved.id);
    console.log('✅ Cleaned up');
    
  } catch (error: any) {
    console.error('❌ Save failed:', error.message);
    console.error('Full error:', error);
  }
}

testSave().catch(console.error);

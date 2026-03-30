#!/usr/bin/env npx tsx
// Check Notion plugin connection

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import path from 'path';

config({ path: path.join(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkConnection() {
  console.log('Checking for Notion connections...\n');

  const { data, error } = await supabase
    .from('plugin_connections')
    .select('*')
    .eq('plugin_key', 'notion');

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  console.log(`Found ${data?.length || 0} Notion connection(s)\n`);

  if (data && data.length > 0) {
    data.forEach((conn: any) => {
      console.log('Connection Details:');
      console.log('  User ID:', conn.user_id);
      console.log('  Plugin Key:', conn.plugin_key);
      console.log('  Plugin Name:', conn.plugin_name);
      console.log('  Status:', conn.status);
      console.log('  Connected At:', conn.connected_at);
      console.log('  Expires At:', conn.expires_at);
      console.log('  Username:', conn.username);
      console.log('');
    });
  } else {
    console.log('No Notion connections found in database.');
    console.log('Checking all plugin connections to see what exists...\n');
    
    const { data: allPlugins } = await supabase
      .from('plugin_connections')
      .select('plugin_key, plugin_name')
      .limit(20);
    
    if (allPlugins && allPlugins.length > 0) {
      console.log('Available plugin keys in database:');
      const uniqueKeys = Array.from(new Set(allPlugins.map((p: any) => p.plugin_key)));
      console.log(uniqueKeys);
    }
  }
}

checkConnection().catch(console.error);

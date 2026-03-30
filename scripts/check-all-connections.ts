#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import path from 'path';

config({ path: path.join(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkConnections() {
  console.log('Checking plugin_connections table...\n');

  // Get all connections
  const { data, error } = await supabase
    .from('plugin_connections')
    .select('*')
    .order('connected_at', { ascending: false });

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  console.log(`Total connections: ${data?.length || 0}\n`);

  // Check for Notion
  const notionConn = data?.find((c: any) => c.plugin_key === 'notion');
  
  if (notionConn) {
    console.log('✅ NOTION CONNECTION FOUND:');
    console.log('  ID:', notionConn.id);
    console.log('  User ID:', notionConn.user_id);
    console.log('  Plugin Key:', notionConn.plugin_key);
    console.log('  Plugin Name:', notionConn.plugin_name);
    console.log('  Status:', notionConn.status);
    console.log('  Username:', notionConn.username);
    console.log('  Connected At:', notionConn.connected_at);
    console.log('  Expires At:', notionConn.expires_at);
  } else {
    console.log('❌ NO NOTION CONNECTION FOUND\n');
    console.log('Existing plugin keys:');
    const keys = [...new Set(data?.map((c: any) => c.plugin_key))];
    console.log(keys);
  }
}

checkConnections().catch(console.error);

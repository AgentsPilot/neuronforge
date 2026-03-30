#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.join(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkPluginConnections() {
  console.log('=== CHECKING ALL PLUGIN CONNECTIONS ===\n');

  // Get all plugin connections
  const { data: connections, error } = await supabase
    .from('plugin_connections')
    .select('*')
    .order('connected_at', { ascending: false });

  if (error) {
    console.error('Error fetching connections:', error);
    return;
  }

  console.log(`Total plugin connections in database: ${connections?.length || 0}\n`);

  // Group by status
  const active = connections?.filter(c => c.status === 'active') || [];
  const inactive = connections?.filter(c => c.status !== 'active') || [];

  console.log('ACTIVE CONNECTIONS:', active.length);
  active.forEach(conn => {
    console.log(`  - ${conn.plugin_key} (${conn.plugin_name})`);
    console.log(`    User: ${conn.user_id}`);
    console.log(`    Connected: ${conn.connected_at}`);
    console.log(`    Expires: ${conn.expires_at || 'Never'}`);
    console.log(`    Status: ${conn.status}`);
    console.log('');
  });

  if (inactive.length > 0) {
    console.log('\nINACTIVE CONNECTIONS:', inactive.length);
    inactive.forEach(conn => {
      console.log(`  - ${conn.plugin_key} (${conn.plugin_name}) - Status: ${conn.status}`);
    });
  }

  // Check for duplicate connections
  const connectionsByPlugin = new Map<string, any[]>();
  connections?.forEach(conn => {
    const key = `${conn.user_id}:${conn.plugin_key}`;
    if (!connectionsByPlugin.has(key)) {
      connectionsByPlugin.set(key, []);
    }
    connectionsByPlugin.get(key)!.push(conn);
  });

  const duplicates = Array.from(connectionsByPlugin.entries()).filter(([_, conns]) => conns.length > 1);
  if (duplicates.length > 0) {
    console.log('\n⚠️  DUPLICATE CONNECTIONS FOUND:');
    duplicates.forEach(([key, conns]) => {
      console.log(`  ${key}:`);
      conns.forEach(c => console.log(`    - ID: ${c.id}, Status: ${c.status}, Connected: ${c.connected_at}`));
    });
  }
}

checkPluginConnections().catch(console.error);

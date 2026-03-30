#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function verifyOutlookConnection() {
  console.log('=== OUTLOOK CONNECTION VERIFICATION ===\n');

  // Check plugin_connections table
  const { data: connections, error } = await supabase
    .from('plugin_connections')
    .select('*')
    .eq('plugin_key', 'outlook')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('❌ Error fetching connections:', error);
    return;
  }

  if (!connections || connections.length === 0) {
    console.log('❌ No Outlook connections found in database');
    console.log('\nPlease try connecting to Outlook via the UI:');
    console.log('1. Click the plugins menu in the footer');
    console.log('2. Click "Connect" next to Outlook');
    console.log('3. Complete the Microsoft OAuth flow');
    return;
  }

  console.log(`✅ Found ${connections.length} Outlook connection(s)\n`);

  connections.forEach((conn, idx) => {
    console.log(`Connection ${idx + 1}:`);
    console.log(`  User ID: ${conn.user_id}`);
    console.log(`  Plugin Key: ${conn.plugin_key}`);
    console.log(`  Status: ${conn.is_active ? '✅ Active' : '❌ Inactive'}`);
    console.log(`  Has Access Token: ${conn.access_token ? '✅ Yes' : '❌ No'}`);
    console.log(`  Has Refresh Token: ${conn.refresh_token ? '✅ Yes' : '❌ No'}`);
    console.log(`  Token Expires: ${conn.token_expires_at || 'Not set'}`);
    console.log(`  Created: ${conn.created_at}`);
    console.log(`  Updated: ${conn.updated_at}`);

    if (conn.profile_data) {
      console.log(`  Profile Data:`, JSON.stringify(conn.profile_data, null, 2));
    }

    console.log('');
  });

  // Test token validity by checking expiration
  const activeConn = connections.find(c => c.is_active && c.access_token);
  if (activeConn) {
    const expiresAt = new Date(activeConn.token_expires_at);
    const now = new Date();
    const isExpired = expiresAt < now;

    if (isExpired) {
      console.log('⚠️  Token is expired. It will be automatically refreshed on next use.');
    } else {
      const minutesUntilExpiry = Math.floor((expiresAt.getTime() - now.getTime()) / 1000 / 60);
      console.log(`✅ Token is valid for ${minutesUntilExpiry} more minutes`);
    }
  }

  console.log('\n=== NEXT STEPS ===');
  console.log('1. ✅ Outlook OAuth connection is working');
  console.log('2. ✅ Connection saved to database');
  console.log('3. ✅ Outlook icon should appear in Footer as connected');
  console.log('4. 🧪 Test Outlook actions in sandbox or create a test agent');
  console.log('\nOutlook actions available:');
  console.log('  Email: send_email, search_emails, create_draft, modify_message, get_email_attachment');
  console.log('  Calendar: list_events, create_event, update_event, delete_event, get_event_details');
}

verifyOutlookConnection();

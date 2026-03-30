#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import fs from 'fs';

config({ path: path.join(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function compare() {
  console.log('=== COMPARING GOOGLE DRIVE VS NOTION ===\n');

  // 1. Check plugin_connections table
  console.log('1. Checking plugin_connections table:');
  const { data: driveConn } = await supabase
    .from('plugin_connections')
    .select('*')
    .eq('plugin_key', 'google-drive')
    .limit(1)
    .single();

  const { data: notionConn } = await supabase
    .from('plugin_connections')
    .select('*')
    .eq('plugin_key', 'notion')
    .limit(1)
    .single();

  console.log('  Google Drive:', driveConn ? '✅ EXISTS' : '❌ NOT FOUND');
  console.log('  Notion:', notionConn ? '✅ EXISTS' : '❌ NOT FOUND');

  if (driveConn) {
    console.log('\n  Drive connection structure:');
    console.log('    plugin_key:', driveConn.plugin_key);
    console.log('    plugin_name:', driveConn.plugin_name);
    console.log('    status:', driveConn.status);
    console.log('    username:', driveConn.username);
    console.log('    email:', driveConn.email);
  }

  // 2. Check plugin definitions
  console.log('\n2. Checking plugin definition files:');
  const driveDef = JSON.parse(fs.readFileSync(path.join(__dirname, '../lib/plugins/definitions/google-drive-plugin-v2.json'), 'utf8'));
  const notionDef = JSON.parse(fs.readFileSync(path.join(__dirname, '../lib/plugins/definitions/notion-plugin-v2.json'), 'utf8'));

  console.log('\n  Google Drive auth_config:');
  console.log('    auth_type:', driveDef.plugin.auth_config.auth_type);
  console.log('    requires_pkce:', driveDef.plugin.auth_config.requires_pkce);
  console.log('    profile_url:', driveDef.plugin.auth_config.profile_url);

  console.log('\n  Notion auth_config:');
  console.log('    auth_type:', notionDef.plugin.auth_config.auth_type);
  console.log('    requires_pkce:', notionDef.plugin.auth_config.requires_pkce);
  console.log('    uses_basic_auth:', notionDef.plugin.auth_config.uses_basic_auth);
  console.log('    profile_url:', notionDef.plugin.auth_config.profile_url);
  console.log('    profile_headers:', notionDef.plugin.auth_config.profile_headers);

  // 3. Check if Notion shows in footer
  console.log('\n3. Next steps to fix Notion:');
  console.log('  - Notion OAuth is completing successfully');
  console.log('  - But connection not being saved to plugin_connections');
  console.log('  - Need to debug why handleOAuthCallback is failing for Notion');
  console.log('  - Check if profile fetch is failing due to missing Notion-Version header');
}

compare().catch(console.error);

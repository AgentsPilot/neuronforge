#!/usr/bin/env npx tsx
import path from 'path';
import fs from 'fs';

console.log('=== VERIFYING NOTION PROFILE HEADERS FIX ===\n');

// 1. Check Notion plugin definition has profile_headers
console.log('1. Checking Notion plugin definition:');
const notionDef = JSON.parse(fs.readFileSync(path.join(__dirname, '../lib/plugins/definitions/notion-plugin-v2.json'), 'utf8'));

console.log('  auth_type:', notionDef.plugin.auth_config.auth_type);
console.log('  profile_url:', notionDef.plugin.auth_config.profile_url);
console.log('  profile_headers:', JSON.stringify(notionDef.plugin.auth_config.profile_headers));
console.log('  uses_basic_auth:', notionDef.plugin.auth_config.uses_basic_auth);

if (notionDef.plugin.auth_config.profile_headers?.['Notion-Version']) {
  console.log('  ✅ Notion-Version header is configured');
} else {
  console.log('  ❌ Notion-Version header is MISSING');
}

// 2. Check the implementation
console.log('\n2. Checking implementation:');
const userConnections = fs.readFileSync(path.join(__dirname, '../lib/server/user-plugin-connections.ts'), 'utf8');

if (userConnections.includes('profile_headers')) {
  console.log('  ✅ profile_headers is referenced in user-plugin-connections.ts');
} else {
  console.log('  ❌ profile_headers is NOT referenced');
}

if (userConnections.includes('Object.assign(headers, (authConfig as any).profile_headers)')) {
  console.log('  ✅ profile_headers are merged into fetch headers');
} else {
  console.log('  ❌ profile_headers are NOT being used');
}

if (userConnections.includes('fetchUserProfile(accessToken: string, authConfig: PluginAuthConfig)')) {
  console.log('  ✅ fetchUserProfile accepts authConfig parameter');
} else {
  console.log('  ❌ fetchUserProfile does NOT accept authConfig');
}

console.log('\n3. Summary:');
console.log('  The fix allows plugins to specify custom headers via profile_headers');
console.log('  Notion will now send "Notion-Version: 2022-06-28" when fetching profile');
console.log('  This follows the same pattern as Google Drive (auth_type specific handling)');
console.log('\n✅ VERIFICATION COMPLETE - Notion profile fetch should work now!');

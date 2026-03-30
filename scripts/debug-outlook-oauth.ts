#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import path from 'path';

config({ path: path.join(__dirname, '../.env.local') });

console.log('=== OUTLOOK OAUTH CONFIGURATION DEBUG ===\n');

// Check environment variables
console.log('1. Environment Variables:');
const clientId = process.env.MICROSOFT_CLIENT_ID;
const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
const appUrl = process.env.NEXT_PUBLIC_APP_URL;

console.log('  MICROSOFT_CLIENT_ID:', clientId ? `${clientId.substring(0, 20)}... (${clientId.length} chars)` : '❌ NOT SET');
console.log('  MICROSOFT_CLIENT_SECRET:', clientSecret ? `${clientSecret.substring(0, 20)}... (${clientSecret.length} chars)` : '❌ NOT SET');
console.log('  NEXT_PUBLIC_APP_URL:', appUrl || '❌ NOT SET');

if (!clientId || !clientSecret) {
  console.log('\n❌ MISSING CREDENTIALS!');
  console.log('\nAdd these to your .env.local:');
  console.log('MICROSOFT_CLIENT_ID=your_client_id_from_azure');
  console.log('MICROSOFT_CLIENT_SECRET=your_client_secret_from_azure');
  process.exit(1);
}

// Check redirect URI
const redirectUri = `${appUrl}/oauth/callback/outlook`;
console.log('\n2. OAuth Configuration:');
console.log('  Redirect URI:', redirectUri);
console.log('  Token URL: https://login.microsoftonline.com/common/oauth2/v2.0/token');
console.log('  Auth URL: https://login.microsoftonline.com/common/oauth2/v2.0/authorize');

// Check required scopes
const scopes = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'https://graph.microsoft.com/Mail.ReadWrite',
  'https://graph.microsoft.com/Mail.Send',
  'https://graph.microsoft.com/Calendars.ReadWrite'
];

console.log('\n3. Required Scopes:');
scopes.forEach(scope => console.log(`  - ${scope}`));

console.log('\n4. Azure Portal Checklist:');
console.log('  ⚠️  Go to https://portal.azure.com/');
console.log('  ⚠️  Navigate to App registrations → Your App');
console.log('  ⚠️  Verify the following:');
console.log('');
console.log('  1. Application (client) ID matches:');
console.log(`     ${clientId}`);
console.log('');
console.log('  2. Client secret is valid (not expired)');
console.log('');
console.log('  3. Redirect URIs includes EXACTLY:');
console.log(`     ${redirectUri}`);
console.log('');
console.log('  4. API permissions include:');
console.log('     - Mail.ReadWrite (Microsoft Graph)');
console.log('     - Mail.Send (Microsoft Graph)');
console.log('     - Calendars.ReadWrite (Microsoft Graph)');
console.log('     - offline_access (Microsoft Graph)');
console.log('');
console.log('  5. Supported account types:');
console.log('     - "Accounts in any organizational directory and personal Microsoft accounts"');

console.log('\n5. Common Issues:');
console.log('  ❌ "Token exchange failed: 401" means:');
console.log('     - Client ID is incorrect');
console.log('     - Client Secret is incorrect or expired');
console.log('     - Redirect URI doesn\'t match Azure configuration');
console.log('     - App registration is for wrong account type');

console.log('\n6. Next Steps:');
console.log('  1. Verify credentials in Azure Portal match .env.local');
console.log('  2. Check client secret hasn\'t expired');
console.log('  3. Verify redirect URI is EXACTLY: ' + redirectUri);
console.log('  4. Restart dev server: npm run dev');
console.log('  5. Try OAuth connection again');

console.log('\n✅ Configuration check complete');

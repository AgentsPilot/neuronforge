#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import path from 'path';

config({ path: path.join(__dirname, '../.env.local') });

console.log('=== NOTION TOKEN EXCHANGE TEST ===\n');

const clientId = process.env.NOTION_CLIENT_ID!;
const clientSecret = process.env.NOTION_CLIENT_SECRET!;
const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/oauth/callback/notion`;

console.log('1. Configuration:');
console.log('  Client ID:', clientId?.substring(0, 25) + '...');
console.log('  Client Secret:', clientSecret?.substring(0, 25) + '...');
console.log('  Redirect URI:', redirectUri);
console.log('  Token URL: https://api.notion.com/v1/oauth/token');

console.log('\n2. Expected Request Format:');
console.log('  Method: POST');
console.log('  Headers:');
console.log('    Content-Type: application/x-www-form-urlencoded');
console.log('    Accept: application/json');
console.log('    Authorization: Basic <base64(client_id:client_secret)>');
console.log('  Body (URLSearchParams):');
console.log('    grant_type=authorization_code');
console.log('    code=<authorization_code>');
console.log('    redirect_uri=' + redirectUri);

console.log('\n3. Check Notion Integration Settings:');
console.log('  ⚠️  Go to https://www.notion.so/my-integrations');
console.log('  ⚠️  Find your OAuth integration');
console.log('  ⚠️  Verify "Redirect URIs" includes EXACTLY:');
console.log('     ', redirectUri);
console.log('  ⚠️  Note: Must match exactly (including protocol, port, trailing slash)');

console.log('\n4. Common "invalid_client" Causes:');
console.log('  - Client ID or Secret is incorrect');
console.log('  - Redirect URI mismatch (most common!)');
console.log('  - OAuth integration not set to "Public" in Notion settings');
console.log('  - Integration has been revoked or disabled');

const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
console.log('\n5. Basic Auth Header (for debugging):');
console.log('  ', `Basic ${credentials.substring(0, 40)}...`);

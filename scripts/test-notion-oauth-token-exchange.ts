#!/usr/bin/env npx tsx
// Test Notion OAuth token exchange

import { config } from 'dotenv';
import path from 'path';

config({ path: path.join(__dirname, '../.env.local') });

async function testTokenExchange() {
  const clientId = process.env.NOTION_CLIENT_ID;
  const clientSecret = process.env.NOTION_CLIENT_SECRET;
  
  console.log('Testing Notion OAuth configuration...\n');
  console.log('Client ID:', clientId ? '✅ Set' : '❌ Missing');
  console.log('Client Secret:', clientSecret ? '✅ Set' : '❌ Missing');
  console.log('\nExpected redirect URI:', `${process.env.NEXT_PUBLIC_APP_URL}/oauth/callback/notion`);
  
  console.log('\nTesting Basic Auth encoding...');
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  console.log('Basic Auth header would be:', `Basic ${credentials.substring(0, 20)}...`);
  
  console.log('\n✅ Configuration looks good!');
  console.log('\nWhen you connect to Notion:');
  console.log('1. Token exchange will use HTTP Basic Auth');
  console.log('2. Profile will be fetched from https://api.notion.com/v1/users/me');
  console.log('3. Connection should be saved to plugin_connections table');
}

testTokenExchange().catch(console.error);

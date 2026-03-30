#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import path from 'path';

config({ path: path.join(__dirname, '../.env.local') });

console.log('=== NOTION CREDENTIALS TEST ===\n');

// Check environment variables
console.log('1. Environment Variables:');
console.log('  NOTION_CLIENT_ID:', process.env.NOTION_CLIENT_ID ? `${process.env.NOTION_CLIENT_ID.substring(0, 20)}...` : '❌ NOT SET');
console.log('  NOTION_CLIENT_SECRET:', process.env.NOTION_CLIENT_SECRET ? `${process.env.NOTION_CLIENT_SECRET.substring(0, 20)}...` : '❌ NOT SET');
console.log('  NEXT_PUBLIC_APP_URL:', process.env.NEXT_PUBLIC_APP_URL);

// Test Basic Auth encoding
if (process.env.NOTION_CLIENT_ID && process.env.NOTION_CLIENT_SECRET) {
  console.log('\n2. Basic Auth Header Test:');
  const credentials = Buffer.from(`${process.env.NOTION_CLIENT_ID}:${process.env.NOTION_CLIENT_SECRET}`).toString('base64');
  console.log('  Credentials format: client_id:client_secret');
  console.log('  Base64 encoded length:', credentials.length);
  console.log('  Authorization header:', `Basic ${credentials.substring(0, 30)}...`);

  // Test if credentials decode properly
  const decoded = Buffer.from(credentials, 'base64').toString('utf-8');
  const [decodedId, decodedSecret] = decoded.split(':');
  console.log('\n3. Decoding Verification:');
  console.log('  Decoded client_id matches:', decodedId === process.env.NOTION_CLIENT_ID ? '✅' : '❌');
  console.log('  Decoded client_secret matches:', decodedSecret === process.env.NOTION_CLIENT_SECRET ? '✅' : '❌');

  // Check for common issues
  console.log('\n4. Common Issues Check:');
  console.log('  Client ID contains spaces:', process.env.NOTION_CLIENT_ID.includes(' ') ? '❌ YES (problem!)' : '✅ No');
  console.log('  Client Secret contains spaces:', process.env.NOTION_CLIENT_SECRET.includes(' ') ? '❌ YES (problem!)' : '✅ No');
  console.log('  Client ID contains newlines:', process.env.NOTION_CLIENT_ID.includes('\n') ? '❌ YES (problem!)' : '✅ No');
  console.log('  Client Secret contains newlines:', process.env.NOTION_CLIENT_SECRET.includes('\n') ? '❌ YES (problem!)' : '✅ No');
} else {
  console.log('\n❌ Cannot test - credentials not set in environment');
}

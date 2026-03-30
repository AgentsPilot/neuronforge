#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import path from 'path';

config({ path: path.join(__dirname, '../.env.local') });

const userId = '08456106-aa50-4810-b12c-7ca84102da31'; // Your user ID from the database

async function testPluginStatusAPI() {
  console.log('=== TESTING PLUGIN STATUS API ===\n');
  console.log('User ID:', userId);
  console.log('API URL: http://localhost:3000/api/plugins/status\n');

  try {
    const response = await fetch(`http://localhost:3000/api/plugins/status?userId=${userId}`);

    if (!response.ok) {
      console.error('❌ API Error:', response.status, response.statusText);
      const text = await response.text();
      console.error('Response:', text);
      return;
    }

    const data = await response.json();

    console.log('✅ API Response received\n');
    console.log('Connected plugins:', data.connected?.length || 0);
    console.log('Active expired:', data.active_expired?.length || 0);
    console.log('Disconnected:', data.disconnected?.length || 0);

    console.log('\n--- CONNECTED PLUGINS ---');
    if (data.connected && data.connected.length > 0) {
      data.connected.forEach((plugin: any) => {
        console.log(`  - ${plugin.key} (${plugin.name})`);
        console.log(`    Actions: ${plugin.action_count}`);
        console.log(`    Connected: ${plugin.connected_at}`);
      });
    } else {
      console.log('  (none)');
    }

    console.log('\n--- ACTIVE EXPIRED ---');
    if (data.active_expired && data.active_expired.length > 0) {
      data.active_expired.forEach((key: string) => {
        console.log(`  - ${key}`);
      });
    } else {
      console.log('  (none)');
    }

    console.log('\n--- DISCONNECTED ---');
    if (data.disconnected && data.disconnected.length > 0) {
      data.disconnected.forEach((plugin: any) => {
        console.log(`  - ${plugin.key}`);
      });
    } else {
      console.log('  (none)');
    }

  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

testPluginStatusAPI().catch(console.error);

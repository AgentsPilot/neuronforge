#!/usr/bin/env node

/**
 * Environment Variable Verification Script for Vercel Deployment
 * This script checks which environment variables are required and provides
 * a checklist for Vercel configuration.
 */

const fs = require('fs');
const path = require('path');

// Parse .env.local file
function parseEnvFile(filePath) {
  const envVars = {};
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#')) continue;

      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim();
        envVars[key] = value;
      }
    }
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error.message);
  }
  return envVars;
}

// Environment variables required for the application
const requiredEnvVars = {
  // Critical - Application will not work without these
  critical: [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'OPENAI_API_KEY',
  ],

  // High Priority - Core features depend on these
  highPriority: [
    'REDIS_URL',
    'CRON_SECRET',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
  ],

  // Medium Priority - Plugin features depend on these
  mediumPriority: [
    'NEXT_PUBLIC_GOOGLE_CLIENT_ID',
    'GMAIL_CLIENT_ID',
    'GMAIL_CLIENT_SECRET',
    'NEXT_PUBLIC_APP_URL',
  ],

  // Optional - Nice to have but not essential
  optional: [
    'GOOGLE_SEARCH_ENGINE_ID',
    'GOOGLE_SEARCH_API_KEY',
    'GMAIL_USER',
    'GMAIL_REFRESH_TOKEN',
    'AGENT_WORKER_CONCURRENCY',
    'NODE_ENV',
    'NEXTAUTH_SECRET',
    'NEXTAUTH_URL',
    'ENCRYPTION_SECRET',
  ],
};

const envVarDescriptions = {
  'NEXT_PUBLIC_SUPABASE_URL': 'Supabase project URL (public)',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY': 'Supabase anonymous/public key',
  'SUPABASE_SERVICE_ROLE_KEY': 'Supabase service role key (CRITICAL for admin APIs)',
  'OPENAI_API_KEY': 'OpenAI API key for GPT-4',
  'REDIS_URL': 'Redis connection URL for BullMQ queue system',
  'CRON_SECRET': 'Secret for securing cron job endpoints',
  'GOOGLE_CLIENT_ID': 'Google OAuth client ID',
  'GOOGLE_CLIENT_SECRET': 'Google OAuth client secret',
  'NEXT_PUBLIC_GOOGLE_CLIENT_ID': 'Google client ID (public)',
  'GMAIL_CLIENT_ID': 'Gmail API client ID',
  'GMAIL_CLIENT_SECRET': 'Gmail API client secret',
  'NEXT_PUBLIC_APP_URL': 'Production URL (https://neuronforge-kohl.vercel.app)',
  'GOOGLE_SEARCH_ENGINE_ID': 'Google Custom Search Engine ID',
  'GOOGLE_SEARCH_API_KEY': 'Google Custom Search API key',
  'GMAIL_USER': 'Gmail address for contact form',
  'GMAIL_REFRESH_TOKEN': 'Gmail OAuth refresh token',
  'AGENT_WORKER_CONCURRENCY': 'Number of concurrent agent workers (default: 3)',
  'NODE_ENV': 'Environment mode (production)',
  'NEXTAUTH_SECRET': 'NextAuth.js secret',
  'NEXTAUTH_URL': 'NextAuth.js URL',
  'ENCRYPTION_SECRET': 'Secret for encrypting credentials',
};

console.log('\n🔍 AgentPilot Environment Variable Verification\n');
console.log('=' .repeat(70));

// Parse local env file
const localEnv = parseEnvFile(path.join(__dirname, '.env.local'));

console.log('\n📋 CRITICAL VARIABLES (App will not work without these):\n');
requiredEnvVars.critical.forEach(key => {
  const hasLocal = !!localEnv[key];
  const status = hasLocal ? '✅' : '❌';
  console.log(`${status} ${key}`);
  console.log(`   ${envVarDescriptions[key] || 'No description'}`);
  if (hasLocal && key.includes('SECRET') || key.includes('KEY') && key !== 'NEXT_PUBLIC_SUPABASE_ANON_KEY') {
    console.log(`   Value: ${localEnv[key].substring(0, 20)}...`);
  } else if (hasLocal) {
    console.log(`   Value: ${localEnv[key]}`);
  }
  console.log('');
});

console.log('\n⚡ HIGH PRIORITY VARIABLES (Core features require these):\n');
requiredEnvVars.highPriority.forEach(key => {
  const hasLocal = !!localEnv[key];
  const status = hasLocal ? '✅' : '❌';
  console.log(`${status} ${key}`);
  console.log(`   ${envVarDescriptions[key] || 'No description'}`);
  if (hasLocal && (key.includes('SECRET') || key.includes('PASSWORD'))) {
    console.log(`   Value: ${localEnv[key].substring(0, 20)}...`);
  } else if (hasLocal) {
    console.log(`   Value: ${localEnv[key]}`);
  }
  console.log('');
});

console.log('\n🔌 MEDIUM PRIORITY VARIABLES (Plugin features):\n');
requiredEnvVars.mediumPriority.forEach(key => {
  const hasLocal = !!localEnv[key];
  const status = hasLocal ? '✅' : '⚠️';
  console.log(`${status} ${key}`);
  console.log(`   ${envVarDescriptions[key] || 'No description'}`);
  if (hasLocal) {
    console.log(`   Value: ${localEnv[key]}`);
  }
  console.log('');
});

console.log('\n📦 OPTIONAL VARIABLES:\n');
requiredEnvVars.optional.forEach(key => {
  const hasLocal = !!localEnv[key];
  const status = hasLocal ? '✅' : '⚪';
  console.log(`${status} ${key}`);
  console.log(`   ${envVarDescriptions[key] || 'No description'}`);
  console.log('');
});

// Generate Vercel CLI command
console.log('\n' + '='.repeat(70));
console.log('\n📝 TO ADD MISSING VARIABLES TO VERCEL:\n');
console.log('Option 1: Via Vercel Dashboard');
console.log('  1. Go to https://vercel.com/dashboard');
console.log('  2. Select your project');
console.log('  3. Go to Settings → Environment Variables');
console.log('  4. Add each variable from the checklist above\n');

console.log('Option 2: Via Vercel CLI (if installed)');
console.log('  Install CLI: npm i -g vercel');
console.log('  Then run these commands:\n');

const criticalAndHigh = [...requiredEnvVars.critical, ...requiredEnvVars.highPriority];
criticalAndHigh.forEach(key => {
  if (localEnv[key]) {
    console.log(`  vercel env add ${key} production`);
  }
});

console.log('\n' + '='.repeat(70));
console.log('\n⚠️  IMPORTANT NOTES:\n');
console.log('1. SUPABASE_SERVICE_ROLE_KEY is CRITICAL for admin APIs');
console.log('   - Without it, /api/admin/* routes will fail');
console.log('   - This is likely causing your 500 error\n');
console.log('2. NEXT_PUBLIC_APP_URL must be your production URL:');
console.log('   - Set to: https://neuronforge-kohl.vercel.app\n');
console.log('3. CRON_SECRET should be a secure random string in production');
console.log('   - Generate with: openssl rand -base64 32\n');
console.log('4. After adding variables, redeploy from Vercel dashboard\n');

// Check for potential issues
console.log('='.repeat(70));
console.log('\n🔧 POTENTIAL ISSUES DETECTED:\n');

if (!localEnv['SUPABASE_SERVICE_ROLE_KEY']) {
  console.log('❌ CRITICAL: SUPABASE_SERVICE_ROLE_KEY is missing!');
  console.log('   This will cause all admin API routes to fail.\n');
}

if (!localEnv['REDIS_URL']) {
  console.log('⚠️  WARNING: REDIS_URL is missing!');
  console.log('   Agent scheduling and queue system will not work.\n');
}

if (!localEnv['CRON_SECRET']) {
  console.log('⚠️  WARNING: CRON_SECRET is missing!');
  console.log('   Scheduled agent execution endpoint is not secured.\n');
}

if (localEnv['NEXT_PUBLIC_APP_URL'] === 'http://localhost:3000') {
  console.log('⚠️  WARNING: NEXT_PUBLIC_APP_URL is set to localhost!');
  console.log('   Production should use: https://neuronforge-kohl.vercel.app\n');
}

console.log('='.repeat(70));
console.log('\n✅ Next Steps:\n');
console.log('1. Review the checklist above');
console.log('2. Add missing CRITICAL and HIGH PRIORITY variables to Vercel');
console.log('3. Update NEXT_PUBLIC_APP_URL to production URL');
console.log('4. Trigger a new deployment from Vercel dashboard');
console.log('5. Check deployment logs for any remaining issues\n');

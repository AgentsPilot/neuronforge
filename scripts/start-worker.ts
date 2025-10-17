// scripts/start-worker.ts
import dotenv from 'dotenv';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

// Debug: Print what we loaded
console.log('Environment check:');
console.log('OPENAI_API_KEY exists:', !!process.env.OPENAI_API_KEY);
console.log('OPENAI_API_KEY length:', process.env.OPENAI_API_KEY?.length);
console.log('REDIS_URL exists:', !!process.env.REDIS_URL);
console.log('SUPABASE_URL exists:', !!process.env.SUPABASE_URL);
console.log('NEXT_PUBLIC_SUPABASE_URL exists:', !!process.env.NEXT_PUBLIC_SUPABASE_URL);
console.log('SUPABASE_SERVICE_ROLE_KEY exists:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);

// Verify critical environment variables
if (!process.env.OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY is missing from environment variables');
  console.error('Available env vars:', Object.keys(process.env).filter(k => k.includes('OPENAI')));
  process.exit(1);
}

// Verify Supabase variables
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Supabase environment variables missing');
  console.error('NEXT_PUBLIC_SUPABASE_URL:', !!process.env.NEXT_PUBLIC_SUPABASE_URL);
  console.error('SUPABASE_SERVICE_ROLE_KEY:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
  console.error('Available Supabase vars:', Object.keys(process.env).filter(k => k.includes('SUPABASE')));
  
  // Show actual values for debugging (first 20 chars only)
  console.error('NEXT_PUBLIC_SUPABASE_URL value:', process.env.NEXT_PUBLIC_SUPABASE_URL?.substring(0, 20));
  console.error('SUPABASE_SERVICE_ROLE_KEY value:', process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0, 20));
  
  process.exit(1);
}

// Verify Redis
if (!process.env.REDIS_URL) {
  console.error('❌ REDIS_URL is missing from environment variables');
  process.exit(1);
}

console.log('✅ All environment variables loaded successfully');
console.log('🔧 Starting agent worker...');

async function startWorker() {
  try {
    // Dynamic import AFTER environment verification to ensure variables are loaded
    const { startAgentWorker } = await import('../lib/queues/agentWorker');
    const worker = startAgentWorker();
    console.log('✅ Agent worker started successfully');
    
    process.on('SIGINT', () => {
      console.log('🛑 Shutting down worker gracefully...');
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      console.log('🛑 Received SIGTERM, shutting down worker gracefully...');
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Failed to start agent worker:', error);
    process.exit(1);
  }
}

startWorker();
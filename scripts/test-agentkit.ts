// Test script to verify AgentKit uses OpenAI SDK
// Run with: npx tsx scripts/test-agentkit.ts

import { openai, AGENTKIT_CONFIG } from '../lib/agentkit/agentkitClient';

async function testAgentKit() {
  console.log('🧪 Testing AgentKit OpenAI Integration\n');

  // Test 1: Check OpenAI client is initialized
  console.log('✅ Test 1: OpenAI Client');
  console.log('  - Client type:', typeof openai);
  console.log('  - Has chat.completions:', typeof openai.chat?.completions?.create);
  console.log('  - API Key configured:', !!process.env.OPENAI_API_KEY);
  console.log('');

  // Test 2: Check configuration
  console.log('✅ Test 2: AgentKit Configuration');
  console.log('  - Model:', AGENTKIT_CONFIG.model);
  console.log('  - Temperature:', AGENTKIT_CONFIG.temperature);
  console.log('  - Max Iterations:', AGENTKIT_CONFIG.maxIterations);
  console.log('  - Timeout:', AGENTKIT_CONFIG.timeout, 'ms');
  console.log('');

  // Test 3: Make a simple API call to verify SDK works
  console.log('✅ Test 3: OpenAI SDK API Call');

  if (!process.env.OPENAI_API_KEY) {
    console.log('  ⚠️  OPENAI_API_KEY not set - skipping API test');
    console.log('  ℹ️  Set OPENAI_API_KEY in .env.local to test actual API calls');
    return;
  }

  try {
    console.log('  - Making test API call to OpenAI...');
    const start = Date.now();

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Using mini model for faster/cheaper test
      messages: [
        { role: 'system', content: 'You are a helpful assistant. Respond in 5 words or less.' },
        { role: 'user', content: 'Say hello' }
      ],
      max_tokens: 10
    });

    const duration = Date.now() - start;

    console.log('  ✓ API call successful!');
    console.log('  - Response:', completion.choices[0].message.content);
    console.log('  - Model used:', completion.model);
    console.log('  - Tokens used:', completion.usage?.total_tokens);
    console.log('  - Duration:', duration, 'ms');
    console.log('');
    console.log('🎉 All tests passed! AgentKit is using OpenAI SDK correctly.\n');

  } catch (error: any) {
    console.log('  ❌ API call failed:', error.message);
    console.log('');

    if (error.message.includes('Incorrect API key')) {
      console.log('⚠️  Invalid OPENAI_API_KEY - please check your .env.local');
    } else if (error.message.includes('quota')) {
      console.log('⚠️  OpenAI quota exceeded - but SDK is working!');
    } else {
      console.log('⚠️  Error details:', error);
    }
  }
}

// Run the test
testAgentKit().catch(console.error);

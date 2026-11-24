/**
 * Jest setup for plugin tests.
 *
 * Sets environment variables required by Supabase client initialization
 * so that transitive imports from plugin-manager-v2 -> user-plugin-connections
 * -> repositories -> supabaseServer do not fail at module load time.
 *
 * These values are never used (all DB calls are mocked) but must be present
 * to prevent the Supabase SDK from throwing during initialization.
 */

/*
 * The one Supabase address variable. Every client, `lib/supabaseAdmin.ts`
 * included, reads it, and so does the middleware's session-cookie name
 * (PROD-1a). No second address is stubbed here on purpose: a stub would hide a
 * reintroduced import-time reader of a retired variable, which
 * `lib/__tests__/envConfigHardening.guard.test.ts` (G-4) scans this file for.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
// Stub OpenAI / Anthropic API keys so that transitive imports through
// `lib/agentkit/agentkitClient.ts` and provider SDKs don't throw at module load.
// The test files mock or bypass actual API calls.
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test-stub-key';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-test-stub-key';

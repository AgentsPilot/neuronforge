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

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
